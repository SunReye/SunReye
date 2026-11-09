// `bun run publish:profiles` (ADR 8): builds, validates and signs the official profiles, then pushes
// only the output to the orphan `profiles-dist` branch that GitHub Pages serves.

import { createHash, createPrivateKey, createPublicKey, sign, verify } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildProfiles } from "../packages/sdk/src/build.ts";
import { git, tryGit } from "./git.ts";

const branch = "profiles-dist";

/** What one publish needs; the signing key never enters the repository. */
export interface Publication {
  /** The checkout whose committed `profiles/` is published. */
  readonly repo: string;
  /** The git remote that receives `profiles-dist`. */
  readonly remote: string;
  /** The profile key's private half, PKCS8 PEM. */
  readonly signingKey: string;
  /** The keys the core compiles in; the fresh bundle must verify against them. */
  readonly keys: Keys | undefined;
}

/** The profile key and its backup: raw Ed25519 public keys. */
export interface Keys {
  readonly active: Uint8Array;
  readonly backup: Uint8Array;
}

/** A Rust `[u8; 32]` literal's bytes, or `undefined` for anything else. */
function keyBytes(literal: string | undefined): Uint8Array | undefined {
  const parts = (literal ?? "").split(",").map((part) => part.trim());
  const values = parts.filter((part) => part !== "").map(Number);

  const valid =
    values.length === 32 && values.every((v) => Number.isInteger(v) && v >= 0 && v <= 255);

  return valid ? new Uint8Array(values) : undefined;
}

const some =
  /^Some\(Keys \{\s*active: \[(?<active>[^\]]*)\],\s*backup: \[(?<backup>[^\]]*)\],?\s*\}\)$/u;

/** The profile keys `crates/core/src/profiles/trust.rs` compiles in, or `undefined` while `None`. */
export function compiledKeys(trust: string): Keys | undefined {
  const keys = /pub const KEYS: Option<Keys> = (?<value>[^;]+);/u.exec(trust)?.groups?.["value"];

  if (keys === "None") return undefined;

  const literals = some.exec(keys ?? "")?.groups;
  const active = keyBytes(literals?.["active"]);
  const backup = keyBytes(literals?.["backup"]);

  if (active !== undefined && backup !== undefined) return { active, backup };

  throw new Error(`trust.rs: KEYS is not None or Some(Keys { active: [..], backup: [..] })`);
}

/** A fresh work tree on `profiles-dist` as the remote holds it, or on a new orphan branch. */
async function checkout(remote: string): Promise<string> {
  const out = await mkdtemp(join(tmpdir(), "profiles-dist-"));

  git(out, ["init", "-q", "-b", branch]);

  if (tryGit(out, ["fetch", "-q", remote, branch]).exitCode === 0)
    git(out, ["reset", "-q", "--hard", "FETCH_HEAD"]);

  return out;
}

/** An entry of the index the build wrote. */
interface Listed {
  readonly id: string;
  readonly version: string;
  readonly schema: number;
  readonly requires: readonly string[];
  readonly sha256: string;
  readonly url: string;
}

interface Signed extends Listed {
  readonly signature: string;
}

/** DER prefix of an Ed25519 SubjectPublicKeyInfo, before its 32 raw key bytes (RFC 8410). */
const spki = Buffer.from("302a300506032b6570032100", "hex");

/**
 * Checks the bundle in `out` as the core will: each file's SHA-256 and its signature over the exact
 * bytes, against the active profile key the core compiles in.
 */
async function verifyBundle(
  out: string,
  signed: readonly Signed[],
  active: Uint8Array,
): Promise<void> {
  const key = createPublicKey({ key: Buffer.concat([spki, active]), format: "der", type: "spki" });
  const files = await Promise.all(signed.map((entry) => readFile(join(out, entry.url))));

  for (const [i, entry] of signed.entries()) {
    const bytes = files[i] ?? Buffer.alloc(0);
    const hashed = createHash("sha256").update(bytes).digest("hex") === entry.sha256;

    if (!hashed || !verify(null, bytes, key, Buffer.from(entry.signature, "hex"))) {
      throw new Error(`${entry.url} does not verify against the compiled profile key`);
    }
  }
}

function isIndex(value: unknown): value is { readonly profiles: readonly Listed[] } {
  return value instanceof Object && "profiles" in value && Array.isArray(value.profiles);
}

/** Signs each built profile into `out` and writes the signed index beside them. */
async function stage(profiles: string, out: string, signingKey: string): Promise<Signed[]> {
  const key = createPrivateKey(signingKey);
  const index: unknown = JSON.parse(await readFile(join(profiles, "index.json"), "utf8"));

  if (!isIndex(index)) throw new TypeError("profiles/index.json lists no profiles");

  git(out, ["rm", "-rqf", "--ignore-unmatch", "."]);

  const signed = await Promise.all(
    index.profiles.map(async (entry) => {
      const bytes = await readFile(join(profiles, entry.url));

      await writeFile(join(out, entry.url), bytes);

      return {
        id: entry.id,
        version: entry.version,
        schema: entry.schema,
        requires: entry.requires,
        sha256: entry.sha256,
        url: entry.url,
        signature: sign(null, bytes, key).toString("hex"),
      };
    }),
  );

  await writeFile(
    join(out, "index.json"),
    `${JSON.stringify({ profiles: signed }, undefined, 2)}\n`,
  );

  return signed;
}

/** Commits and pushes `out`; returns the commit, or `undefined` when nothing changed. */
function push(out: string, remote: string): string | undefined {
  git(out, ["add", "-A"]);

  if (tryGit(out, ["diff", "--cached", "--quiet"]).exitCode === 0) {
    return undefined;
  }

  git(out, ["commit", "-q", "-m", "publish profiles"]);
  git(out, ["push", "-q", remote, branch]);

  return git(out, ["rev-parse", "HEAD"]).trim();
}

/**
 * Builds `profiles/`, signs its output into a `profiles-dist` work tree, verifies it against the
 * compiled profile key, then commits and pushes it. Returns the new commit, or `undefined` when the
 * published output is already current.
 */
export async function publishProfiles(publication: Publication): Promise<string | undefined> {
  const { repo, remote, signingKey, keys } = publication;
  const profiles = join(repo, "profiles");

  if (keys === undefined) {
    throw new Error(
      "the core compiles in no profile key yet: publishing waits for the key ceremony",
    );
  }

  await buildProfiles(profiles, profiles);

  // The committed build is the next one's version baseline, so only a committed build publishes.
  if (git(repo, ["status", "--porcelain", "--", "profiles"]) !== "") {
    throw new Error("profiles/ differs from its commit: commit the build first");
  }

  const out = await checkout(remote);

  try {
    const signed = await stage(profiles, out, signingKey);

    await verifyBundle(out, signed, keys.active);

    return push(out, remote);
  } finally {
    await rm(out, { recursive: true });
  }
}

if (import.meta.main) {
  const repo = new URL("..", import.meta.url).pathname;
  const keyPath = process.env["SUNREYE_PROFILE_KEY"];

  if (keyPath === undefined) throw new Error("SUNREYE_PROFILE_KEY names no private key file");

  const trust = await readFile(join(repo, "crates/core/src/profiles/trust.rs"), "utf8");

  const commit = await publishProfiles({
    repo,
    remote: git(repo, ["remote", "get-url", "origin"]).trim(),
    signingKey: await readFile(keyPath, "utf8"),
    keys: compiledKeys(trust),
  });

  process.stderr.write(commit === undefined ? "profiles-dist is current\n" : `pushed ${commit}\n`);
}
