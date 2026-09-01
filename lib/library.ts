/**
 * Generation library. Server-side only.
 *
 * Two drivers, chosen by environment rather than by config:
 *  · blob — Vercel Blob, used whenever BLOB_READ_WRITE_TOKEN exists. Required
 *           in production: serverless filesystems are read-only, so the fs
 *           driver would silently lose every generation.
 *  · fs   — .data/generated on disk. The local default; the files are the point.
 *
 * Saving never blocks a generation: a storage failure is logged and the image
 * still comes back to the browser.
 */

import { mkdir, readFile, readdir, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

export interface LibraryEntry {
  id: string;
  createdAt: string;
  typeId: string;
  shapeId: string;
  market: string;
  brief: string;
  prompt: string;
  width: number;
  height: number;
  bytes: number;
  /** where the PNG can be fetched from */
  url: string;
}

const ROOT = path.join(process.cwd(), ".data", "generated");
const ID_RE = /^[a-z0-9-]{6,64}$/;
const blobToken = () => process.env.BLOB_READ_WRITE_TOKEN;

export const storageDriver = (): "blob" | "fs" => (blobToken() ? "blob" : "fs");

/* ------------------------------------------------------------------ blob */

async function blobApi() {
  // imported lazily so local dev never needs the package resolved at boot
  return import("@vercel/blob");
}

async function blobSave(id: string, png: Buffer, entry: LibraryEntry): Promise<LibraryEntry> {
  const { put } = await blobApi();
  const img = await put(`generated/${id}.png`, png, {
    access: "public",
    contentType: "image/png",
    addRandomSuffix: false,
  });
  const full: LibraryEntry = { ...entry, url: img.url };
  await put(`generated/${id}.json`, JSON.stringify(full), {
    access: "public",
    contentType: "application/json",
    addRandomSuffix: false,
  });
  return full;
}

async function blobList(limit: number): Promise<LibraryEntry[]> {
  const { list } = await blobApi();
  const { blobs } = await list({ prefix: "generated/", limit: 1000 });
  const metas = blobs.filter(b => b.pathname.endsWith(".json"));
  const out: LibraryEntry[] = [];
  for (const b of metas) {
    try {
      const res = await fetch(b.url, { cache: "no-store" });
      if (res.ok) {
        const raw = (await res.json()) as Partial<LibraryEntry>;
        if (raw.id && raw.url) out.push({ ...(raw as LibraryEntry), bytes: raw.bytes ?? 0 });
      }
    } catch {
      /* skip an unreadable entry rather than failing the whole listing */
    }
  }
  return out.sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? "")).slice(0, limit);
}

async function blobDelete(id: string): Promise<boolean> {
  const { del, list } = await blobApi();
  const { blobs } = await list({ prefix: `generated/${id}.`, limit: 10 });
  if (!blobs.length) return false;
  await del(blobs.map(b => b.url));
  return true;
}

/* -------------------------------------------------------------------- fs */

async function fsSave(id: string, png: Buffer, entry: LibraryEntry): Promise<LibraryEntry> {
  await mkdir(ROOT, { recursive: true });
  await writeFile(path.join(ROOT, `${id}.png`), png);
  await writeFile(path.join(ROOT, `${id}.json`), JSON.stringify(entry, null, 2), "utf8");
  return entry;
}

async function fsList(limit: number): Promise<LibraryEntry[]> {
  try {
    const files = await readdir(ROOT);
    const pngs = new Set(files.filter(x => x.endsWith(".png")).map(x => x.replace(/\.png$/, "")));
    const out: LibraryEntry[] = [];
    for (const f of files.filter(x => x.endsWith(".json"))) {
      try {
        const raw = JSON.parse(await readFile(path.join(ROOT, f), "utf8")) as Partial<LibraryEntry>;
        const id = raw.id ?? f.replace(/\.json$/, "");
        // an entry whose image is gone would render as a dead card
        if (!pngs.has(id)) continue;
        // entries written before url/bytes existed are repaired on read
        const bytes = raw.bytes ?? (await stat(path.join(ROOT, `${id}.png`)).then(x => x.size, () => 0));
        out.push({ ...(raw as LibraryEntry), id, bytes, url: raw.url ?? `/api/library?id=${id}` });
      } catch {
        /* skip a half-written file */
      }
    }
    return out.sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? "")).slice(0, limit);
  } catch {
    return [];
  }
}

async function fsDelete(id: string): Promise<boolean> {
  try {
    await unlink(path.join(ROOT, `${id}.png`));
    await unlink(path.join(ROOT, `${id}.json`)).catch(() => {});
    return true;
  } catch {
    return false;
  }
}

/* ----------------------------------------------------------------- public */

export async function saveGeneration(
  id: string,
  png: Buffer,
  meta: Omit<LibraryEntry, "id" | "createdAt" | "bytes" | "url">
): Promise<LibraryEntry | null> {
  const entry: LibraryEntry = {
    id,
    createdAt: new Date().toISOString(),
    bytes: png.byteLength,
    url: `/api/library?id=${id}`,
    ...meta,
  };
  try {
    return storageDriver() === "blob" ? await blobSave(id, png, entry) : await fsSave(id, png, entry);
  } catch (err) {
    console.error("[library] save failed:", err);
    return null;
  }
}

export async function listGenerations(limit = 60): Promise<LibraryEntry[]> {
  try {
    return storageDriver() === "blob" ? await blobList(limit) : await fsList(limit);
  } catch (err) {
    console.error("[library] list failed:", err);
    return [];
  }
}

/** fs driver only — the blob driver serves its own public URLs. */
export async function readGeneration(id: string): Promise<Buffer | null> {
  if (!ID_RE.test(id)) return null; // no traversal
  try {
    return await readFile(path.join(ROOT, `${id}.png`));
  } catch {
    return null;
  }
}

export async function deleteGeneration(id: string): Promise<boolean> {
  if (!ID_RE.test(id)) return false;
  try {
    return storageDriver() === "blob" ? await blobDelete(id) : await fsDelete(id);
  } catch (err) {
    console.error("[library] delete failed:", err);
    return false;
  }
}
