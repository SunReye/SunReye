/**
 * Git-backed profile repository client — the Home Assistant Supervisor
 * add-on-repo model. A "source" is a public git repo URL; we shallow-clone it
 * (or `git pull` an existing clone) into a disposable cache dir and read a root
 * `index.json` manifest listing the committed `ProfileData` files.
 *
 * The clone cache is never the source of truth — the chosen profile JSON is
 * copied into the `installed_profiles` table on download — so it can be wiped or
 * live on an ephemeral container FS with nothing lost. Only public `https` git
 * URLs are accepted (validated upstream in `@SunReye/db/profiles`); we re-check
 * here and guard against path traversal out of the clone dir.
 */

import { createHash } from "node:crypto";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { env } from "@SunReye/env/server";
import type { ProfileData, RepoIndex } from "@SunReye/inverter-core";
import { parseProfileData, repoIndexSchema } from "@SunReye/inverter-core";

import { log } from "../shared/logging";

export type { RepoIndex, RepoProfileEntry } from "@SunReye/inverter-core";

const logger = log("git-source");

/** Where clones are cached. Disposable — see the module doc. */
const CACHE_ROOT = join(tmpdir(), "sunreye-profile-repos");

/** Hard limit on how long any git invocation may run. */
const GIT_TIMEOUT_MS = 30_000;

/** Refuse to parse a profile/index larger than this (defense against junk). */
const MAX_FILE_BYTES = 1_000_000;

function assertAllowedGitUrl(url: string): void {
  if (url.startsWith("https://")) return;
  // `file://` is a local-only convenience for dev/tests; production sources are
  // https-only (enforced again at config time by `profileSourceSchema`).
  if (url.startsWith("file://") && env.NODE_ENV !== "production") return;
  throw new Error(`only https git URLs are allowed: ${url}`);
}

function cacheDirFor(url: string): string {
  return join(CACHE_ROOT, createHash("sha256").update(url).digest("hex").slice(0, 16));
}

/**
 * Ambient git plumbing variables. When they are set — anything launched from a
 * git hook exports them — every `git` we spawn is redirected at THAT repository
 * regardless of `cwd`, so a clone into the profile cache fails with "does not
 * appear to be a git repository" and a commit would land somewhere nobody asked
 * for. We always operate on our own cache dir, so they are never wanted.
 */
const AMBIENT_GIT_ENV =
  /^GIT_(DIR|WORK_TREE|INDEX_FILE|PREFIX|COMMON_DIR|OBJECT_DIRECTORY|NAMESPACE)$/;

/** `env` minus the ambient plumbing, with unset keys dropped. */
// fallow-ignore-next-line unused-export -- asserted by git-source.test.ts, which also reuses it for its own fixture; test files aren't traced as consumers
export function cleanGitEnv(env: Record<string, string | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (value !== undefined && !AMBIENT_GIT_ENV.test(key)) out[key] = value;
  }
  return out;
}

/** Run a git subcommand with a hard timeout; throws on non-zero exit. */
async function git(args: string[], cwd?: string): Promise<void> {
  const proc = Bun.spawn(["git", ...args], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    env: { ...cleanGitEnv(process.env), GIT_TERMINAL_PROMPT: "0" }, // never block on a credential prompt
  });
  const timer = setTimeout(() => proc.kill(), GIT_TIMEOUT_MS);
  try {
    const code = await proc.exited;
    if (code !== 0) {
      const stderr = await new Response(proc.stderr).text();
      throw new Error(`git ${args[0]} failed (${code}): ${stderr.trim().slice(0, 500)}`);
    }
  } finally {
    clearTimeout(timer);
  }
}

/**
 * In-flight sync per cache dir. Two git processes in the same repo race on
 * `.git/*.lock` ("Another git process seems to be running"), so overlapping
 * callers for the same URL — a browse polled from the UI, a browse overlapping a
 * download — must run one at a time, not concurrently.
 */
const syncChains = new Map<string, Promise<unknown>>();

/**
 * Clone the repo on first use, or update an existing clone. Returns the local
 * working-tree directory. Syncs for the same dir are serialized (see
 * {@link syncChains}); a failed update wipes the cache and re-clones so a
 * corrupt clone — or a stale lock left by a process killed across a restart —
 * can't wedge the source permanently.
 */
export async function syncRepo(url: string): Promise<string> {
  assertAllowedGitUrl(url);
  const dir = cacheDirFor(url);
  // Chain onto any in-flight sync for this dir, running regardless of whether it
  // resolved or rejected, so we never launch a second concurrent git here.
  const prior = syncChains.get(dir) ?? Promise.resolve();
  const result = prior.then(
    () => doSync(dir, url),
    () => doSync(dir, url),
  );
  // Advance the chain with a rejection-swallowing link so the next caller isn't
  // poisoned by our failure, and drop the entry once it's the last to settle.
  const link = result.catch(() => {});
  syncChains.set(dir, link);
  void link.finally(() => {
    if (syncChains.get(dir) === link) syncChains.delete(dir);
  });
  return result;
}

async function doSync(dir: string, url: string): Promise<string> {
  const exists = await Bun.file(join(dir, ".git", "HEAD")).exists();
  if (!exists) {
    await rm(dir, { recursive: true, force: true });
    await git(["clone", "--depth", "1", url, dir]);
    return dir;
  }
  try {
    await git(["fetch", "--depth", "1", "origin"], dir);
    await git(["reset", "--hard", "FETCH_HEAD"], dir);
  } catch (error) {
    logger.warn("update failed for {url}, re-cloning: {error}", {
      url,
      error: error instanceof Error ? error.message : String(error),
    });
    await rm(dir, { recursive: true, force: true });
    await git(["clone", "--depth", "1", url, dir]);
  }
  return dir;
}

/** Read a repo-relative file, guarding against traversal and oversized files. */
async function readRepoFile(dir: string, relPath: string): Promise<string> {
  const full = resolve(dir, relPath);
  if (full !== dir && !full.startsWith(dir + "/")) {
    throw new Error(`path escapes repository: ${relPath}`);
  }
  const file = Bun.file(full);
  if (!(await file.exists())) throw new Error(`file not found in repo: ${relPath}`);
  if (file.size > MAX_FILE_BYTES) throw new Error(`file too large: ${relPath}`);
  return file.text();
}

/** Parse and validate a repo's root `index.json`. */
export async function readIndex(dir: string): Promise<RepoIndex> {
  const raw = await readRepoFile(dir, "index.json");
  return repoIndexSchema.parse(JSON.parse(raw));
}

/** Read and strictly validate one profile file listed in the index. */
export async function readProfile(dir: string, relPath: string): Promise<ProfileData> {
  const raw = await readRepoFile(dir, relPath);
  return parseProfileData(JSON.parse(raw));
}
