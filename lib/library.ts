/**
 * Local generation library. Server-side only.
 *
 * Generations are written to .data/generated so a session's work survives a
 * refresh. Deliberately a plain directory, not a database — this is a local
 * tool and the files are the point. Failure to write is never fatal: the
 * route still returns the image.
 */

import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

const ROOT = path.join(process.cwd(), ".data", "generated");

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
}

export async function saveGeneration(
  id: string,
  png: Buffer,
  meta: Omit<LibraryEntry, "id" | "createdAt">
): Promise<LibraryEntry | null> {
  const entry: LibraryEntry = { id, createdAt: new Date().toISOString(), ...meta };
  try {
    await mkdir(ROOT, { recursive: true });
    await writeFile(path.join(ROOT, `${id}.png`), png);
    await writeFile(path.join(ROOT, `${id}.json`), JSON.stringify(entry, null, 2), "utf8");
    return entry;
  } catch {
    return null;
  }
}

export async function listGenerations(limit = 40): Promise<LibraryEntry[]> {
  try {
    const files = await readdir(ROOT);
    const metas = files.filter(f => f.endsWith(".json"));
    const out: LibraryEntry[] = [];
    for (const f of metas) {
      try {
        out.push(JSON.parse(await readFile(path.join(ROOT, f), "utf8")) as LibraryEntry);
      } catch {
        /* skip a half-written file */
      }
    }
    return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit);
  } catch {
    return [];
  }
}

export async function readGeneration(id: string): Promise<Buffer | null> {
  if (!/^[a-z0-9-]{6,64}$/.test(id)) return null; // no traversal
  try {
    return await readFile(path.join(ROOT, `${id}.png`));
  } catch {
    return null;
  }
}
