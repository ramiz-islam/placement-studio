/**
 * Generation library. Server-side only.
 *
 * Three drivers, chosen by environment rather than by config, because the
 * filesystem is only writable in one of the three places this app runs:
 *  · r2   — Cloudflare R2, when the Worker has a GENERATIONS bucket binding.
 *           Required on Cloudflare: Workers have no filesystem at all.
 *  · blob — Vercel Blob, when BLOB_READ_WRITE_TOKEN exists.
 *  · fs   — .data/generated on disk. The local default; the files are the point.
 *
 * Every driver is imported lazily so a platform never bundles the others'
 * dependencies, and saving never blocks a generation: a storage failure is
 * logged and the image still comes back to the browser.
 */

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

type Driver = "r2" | "blob" | "fs";

/** The R2 bucket binding, when running on Cloudflare. */
interface Bucket {
  put(key: string, value: ArrayBuffer | string, opts?: unknown): Promise<unknown>;
  get(key: string): Promise<{ arrayBuffer(): Promise<ArrayBuffer>; text(): Promise<string> } | null>;
  delete(keys: string | string[]): Promise<void>;
  list(opts?: { prefix?: string; limit?: number }): Promise<{ objects: { key: string }[] }>;
}

async function r2(): Promise<Bucket | null> {
  try {
    const { getCloudflareContext } = await import("@opennextjs/cloudflare");
    const env = getCloudflareContext().env as unknown as { GENERATIONS?: Bucket };
    return env.GENERATIONS ?? null;
  } catch {
    return null; // not running on Cloudflare
  }
}

export async function storageDriver(): Promise<Driver> {
  if (await r2()) return "r2";
  if (process.env.BLOB_READ_WRITE_TOKEN) return "blob";
  return "fs";
}

/* -------------------------------------------------------------------- r2 */

async function r2Save(bucket: Bucket, id: string, png: Buffer, entry: LibraryEntry): Promise<LibraryEntry> {
  const full: LibraryEntry = { ...entry, url: `/api/library?id=${id}` };
  await bucket.put(`${id}.png`, png.buffer.slice(png.byteOffset, png.byteOffset + png.byteLength) as ArrayBuffer, {
    httpMetadata: { contentType: "image/png" },
  });
  await bucket.put(`${id}.json`, JSON.stringify(full), {
    httpMetadata: { contentType: "application/json" },
  });
  return full;
}

async function r2List(bucket: Bucket, limit: number): Promise<LibraryEntry[]> {
  const { objects } = await bucket.list({ limit: 1000 });
  const out: LibraryEntry[] = [];
  for (const o of objects.filter(x => x.key.endsWith(".json"))) {
    try {
      const obj = await bucket.get(o.key);
      if (!obj) continue;
      out.push(JSON.parse(await obj.text()) as LibraryEntry);
    } catch {
      /* skip an unreadable entry rather than failing the whole listing */
    }
  }
  return out.sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? "")).slice(0, limit);
}

/* ------------------------------------------------------------------ blob */

async function blobSave(id: string, png: Buffer, entry: LibraryEntry): Promise<LibraryEntry> {
  const { put } = await import("@vercel/blob");
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
  const { list } = await import("@vercel/blob");
  const { blobs } = await list({ prefix: "generated/", limit: 1000 });
  const out: LibraryEntry[] = [];
  for (const b of blobs.filter(x => x.pathname.endsWith(".json"))) {
    try {
      const res = await fetch(b.url, { cache: "no-store" });
      if (!res.ok) continue;
      const raw = (await res.json()) as Partial<LibraryEntry>;
      if (raw.id && raw.url) out.push({ ...(raw as LibraryEntry), bytes: raw.bytes ?? 0 });
    } catch {
      /* skip */
    }
  }
  return out.sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? "")).slice(0, limit);
}

async function blobDelete(id: string): Promise<boolean> {
  const { del, list } = await import("@vercel/blob");
  const { blobs } = await list({ prefix: `generated/${id}.`, limit: 10 });
  if (!blobs.length) return false;
  await del(blobs.map(b => b.url));
  return true;
}

/* -------------------------------------------------------------------- fs */

async function fsMod() {
  // dynamic so a Workers bundle never pulls node:fs in
  return import("node:fs/promises");
}

async function fsSave(id: string, png: Buffer, entry: LibraryEntry): Promise<LibraryEntry> {
  const { mkdir, writeFile } = await fsMod();
  await mkdir(ROOT, { recursive: true });
  await writeFile(path.join(ROOT, `${id}.png`), png);
  await writeFile(path.join(ROOT, `${id}.json`), JSON.stringify(entry, null, 2), "utf8");
  return entry;
}

async function fsList(limit: number): Promise<LibraryEntry[]> {
  const { readFile, readdir, stat } = await fsMod();
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
  const { unlink } = await fsMod();
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
    const bucket = await r2();
    if (bucket) return await r2Save(bucket, id, png, entry);
    if (process.env.BLOB_READ_WRITE_TOKEN) return await blobSave(id, png, entry);
    return await fsSave(id, png, entry);
  } catch (err) {
    console.error("[library] save failed:", err);
    return null;
  }
}

export async function listGenerations(limit = 60): Promise<LibraryEntry[]> {
  try {
    const bucket = await r2();
    if (bucket) return await r2List(bucket, limit);
    if (process.env.BLOB_READ_WRITE_TOKEN) return await blobList(limit);
    return await fsList(limit);
  } catch (err) {
    console.error("[library] list failed:", err);
    return [];
  }
}

/** Serves the PNG for the r2 and fs drivers; the blob driver has public URLs. */
export async function readGeneration(id: string): Promise<ArrayBuffer | null> {
  if (!ID_RE.test(id)) return null; // no traversal
  try {
    const bucket = await r2();
    if (bucket) {
      const obj = await bucket.get(`${id}.png`);
      return obj ? await obj.arrayBuffer() : null;
    }
    const { readFile } = await fsMod();
    const buf = await readFile(path.join(ROOT, `${id}.png`));
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
  } catch {
    return null;
  }
}

export async function deleteGeneration(id: string): Promise<boolean> {
  if (!ID_RE.test(id)) return false;
  try {
    const bucket = await r2();
    if (bucket) {
      await bucket.delete([`${id}.png`, `${id}.json`]);
      return true;
    }
    if (process.env.BLOB_READ_WRITE_TOKEN) return await blobDelete(id);
    return await fsDelete(id);
  } catch (err) {
    console.error("[library] delete failed:", err);
    return false;
  }
}
