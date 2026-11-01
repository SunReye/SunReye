// fallow-ignore-file unused-export -- staleFiles is used by the freshness tests only; test files are not traced as consumers
/**
 * The oracle corpus on disk: where it lives, how a group's output is serialised, and how a
 * committed file is compared with what its generator produces now.
 *
 * Output is text a generator builds from fixed inputs. Nothing here reads a clock or a random
 * source, so a second run is byte-identical.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

/** `fixtures/oracle/`, resolved from this file so it works from any cwd. */
export const CORPUS_DIR = new URL("../../fixtures/oracle/", import.meta.url).pathname;

/** Corpus-relative path to file content. */
export type CorpusFiles = Record<string, string | Uint8Array>;

/** One JSON document per line, newline-terminated. */
export function ndjson(rows: readonly unknown[]): string {
  return rows.map((row) => JSON.stringify(row)).join("\n") + "\n";
}

/** Lowercase hex without separators. */
export function hex(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("hex");
}

const same = (a: string | Uint8Array, b: string | Uint8Array): boolean =>
  Buffer.compare(Buffer.from(a), Buffer.from(b)) === 0;

/** Write every file, creating directories. */
export async function writeCorpus(files: CorpusFiles, dir = CORPUS_DIR): Promise<void> {
  for (const [path, content] of Object.entries(files)) {
    const target = join(dir, path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, content);
  }
}

/** Paths whose committed content is missing or differs from `files`. Sorted. */
export async function staleFiles(files: CorpusFiles, dir = CORPUS_DIR): Promise<string[]> {
  const stale: string[] = [];
  for (const [path, content] of Object.entries(files)) {
    const committed = await readFile(join(dir, path)).catch(() => null);
    if (committed === null || !same(committed, content)) stale.push(path);
  }
  return stale.sort();
}
