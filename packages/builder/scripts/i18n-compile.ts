// Incremental, cross-process-safe Paraglide compilation (ADR 11): skips compiling when the
// message sources, project settings and extra inputs (the lockfile, so a compiler upgrade counts)
// match the last compile and its outputs are as it wrote them; serialises concurrent
// callers (such as `bun test --parallel` workers) behind an atomic lock directory.

import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { rename } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Inputs, outputs and compiler for one Paraglide message bundle. */
export interface Bundle {
  /** Folder holding `project.inlang` and `messages`. */
  readonly root: string;
  /** Output directory written by the compiler. */
  readonly outdir: string;
  /** Paths relative to `outdir` that must exist for a cached build to count as fresh. */
  readonly outputs: readonly string[];
  /** Extra inputs (such as the calling script) whose content invalidates the cache. */
  readonly extra?: readonly string[];
  /** Runs the compiler when the outputs are absent or stale. */
  readonly compile: () => Promise<void>;
}

const STALE_LOCK_MS = 60_000;
const RETRY_MS = 20;
const MAX_WAIT_MS = 30_000;

/** All files under `dir`, sorted by relative path. */
function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];

  return (
    readdirSync(dir, { recursive: true, withFileTypes: true })
      // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Dirent is only read.
      .filter((entry) => entry.isFile())
      // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Dirent is only read.
      .map((entry) => join(entry.parentPath, entry.name))
      .toSorted()
  );
}

/** SHA-256 over the bundle's inputs and compiler target. */
function digest(bundle: Readonly<Bundle>): string {
  const hash = createHash("sha256").update(bundle.outdir).update("\0");

  const files = [
    ...walk(join(bundle.root, "project.inlang")),
    ...walk(join(bundle.root, "messages")),
    ...(bundle.extra ?? []),
  ].toSorted();

  for (const file of files) {
    hash.update(file).update("\0");

    if (existsSync(file)) hash.update(readFileSync(file));

    hash.update("\0");
  }

  return hash.digest("hex");
}

/** SHA-256 over every file the compile wrote. */
function written(bundle: Readonly<Bundle>): string {
  const hash = createHash("sha256");

  for (const file of walk(bundle.outdir)) hash.update(file).update("\0").update(readFileSync(file));

  return hash.digest("hex");
}

function isFresh(bundle: Readonly<Bundle>, stampPath: string, expected: string): boolean {
  if (!existsSync(stampPath)) return false;

  if (!bundle.outputs.every((file) => existsSync(join(bundle.outdir, file)))) return false;

  return readFileSync(stampPath, "utf8") === `${expected}\n${written(bundle)}`;
}

function tryLock(lockDir: string): boolean {
  try {
    mkdirSync(lockDir);

    return true;
  } catch (error) {
    const code = error instanceof Error && "code" in error ? String(error.code) : "";

    if (code !== "EEXIST") throw error;

    try {
      if (Date.now() - statSync(lockDir).mtimeMs > STALE_LOCK_MS) {
        rmSync(lockDir, { recursive: true, force: true });
      }
    } catch {
      // Another worker removed the lock concurrently.
    }

    return false;
  }
}

async function acquireLock(lockDir: string, deadline: number): Promise<void> {
  if (tryLock(lockDir)) return;

  if (Date.now() >= deadline) {
    rmSync(lockDir, { recursive: true, force: true });

    if (tryLock(lockDir)) return;

    throw new Error(`timed out waiting for i18n lock ${lockDir}`);
  }

  await Bun.sleep(RETRY_MS);

  return acquireLock(lockDir, deadline);
}

/** Compiles `bundle` unless its outputs already exist and match the current inputs. */
export async function compileIfStale(bundle: Readonly<Bundle>): Promise<boolean> {
  const key = createHash("sha256").update(bundle.outdir).digest("hex").slice(0, 16);
  const cacheDir = join(tmpdir(), "sunreye-i18n-cache");
  const stampPath = join(cacheDir, `${key}.stamp`);
  const lockDir = join(cacheDir, `${key}.lock`);
  const expected = digest(bundle);

  if (isFresh(bundle, stampPath, expected)) return false;

  mkdirSync(cacheDir, { recursive: true });
  await acquireLock(lockDir, Date.now() + MAX_WAIT_MS);

  try {
    if (isFresh(bundle, stampPath, expected)) return false;

    await bundle.compile();

    const temp = `${stampPath}.${String(process.pid)}.${String(Date.now())}`;

    writeFileSync(temp, `${expected}\n${written(bundle)}`);
    await rename(temp, stampPath);

    return true;
  } finally {
    rmSync(lockDir, { recursive: true, force: true });
  }
}
