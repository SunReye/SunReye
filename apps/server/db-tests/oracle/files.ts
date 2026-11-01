/** Corpus file helpers for the oracle's database groups (apps/server cannot import scripts/). */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import type { createDbAt } from "@SunReye/db";

export type Db = ReturnType<typeof createDbAt>;

/** `fixtures/oracle/` at the repository root. */
export const CORPUS_DIR = new URL("../../../../fixtures/oracle/", import.meta.url).pathname;

export type Files = Record<string, string | Uint8Array>;

/** One JSON document per line, newline-terminated. */
export const ndjson = (rows: readonly unknown[]): string =>
  rows.map((row) => JSON.stringify(row)).join("\n") + "\n";

export async function write(files: Files): Promise<void> {
  for (const [path, content] of Object.entries(files)) {
    await mkdir(dirname(join(CORPUS_DIR, path)), { recursive: true });
    await writeFile(join(CORPUS_DIR, path), content);
  }
}

/** Paths whose committed bytes differ from `files`, or that are missing. */
export async function stale(files: Files): Promise<string[]> {
  const out: string[] = [];
  for (const [path, content] of Object.entries(files)) {
    const committed = await readFile(join(CORPUS_DIR, path)).catch(() => null);
    if (committed === null || Buffer.compare(committed, Buffer.from(content)) !== 0) out.push(path);
  }
  return out.sort();
}
