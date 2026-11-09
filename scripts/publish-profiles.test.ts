import { expect, test } from "bun:test";
import {
  createHash,
  createPublicKey,
  generateKeyPairSync,
  type KeyObject,
  verify,
} from "node:crypto";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildProfiles } from "../packages/sdk/src/build.ts";
import { compiledKeys, type Publication, publishProfiles } from "./publish-profiles.ts";

const source = await Bun.file(
  new URL("../crates/core/src/profiles/trust.rs", import.meta.url),
).text();

function rust(keys: string): string {
  return `/// The compiled-in profile keys.\npub const KEYS: Option<Keys> = ${keys};\n`;
}

test("no compiled profile key reads as none, pending the key ceremony", () => {
  expect(compiledKeys(rust("None"))).toBeUndefined();
});

test("compiled profile keys read as their 32 bytes each", () => {
  const active = Array.from({ length: 32 }, (_, i) => i);
  const backup = Array.from({ length: 32 }, (_, i) => 255 - i);
  const hex = backup.map((byte) => `0x${byte.toString(16)}`);
  const keys = `Some(Keys {\n    active: [${active.join(", ")}],\n    backup: [${hex.join(", ")}],\n})`;

  expect(compiledKeys(rust(keys))).toEqual({
    active: new Uint8Array(active),
    backup: new Uint8Array(backup),
  });
});

test("compiled profile keys of any other shape are refused, never read as none", () => {
  expect(() => compiledKeys(rust("Some(Keys { active: [1, 2], backup: [3] })"))).toThrow(
    "KEYS is not None",
  );
});

test("the core's compiled profile keys are in a shape the publish reads", () => {
  expect(() => compiledKeys(source)).not.toThrow();
});

const meter = {
  schema: 1,
  id: "meter",
  name: "Meter",
  manufacturer: "Test",
  version: "1.0.0",
  requires: ["modbus", "u16"],
  quantities: [{ key: "power", role: "grid.power", register: 10, type: "u16" }],
};

/** DER prefix of an Ed25519 SubjectPublicKeyInfo, before its 32 raw key bytes (RFC 8410). */
const spki = Buffer.from("302a300506032b6570032100", "hex");

interface TestKey {
  /** PKCS8 PEM. */
  readonly pem: string;
  readonly raw: Uint8Array;
}

/** A key pair made for one test, never a release key. */
function testKey(): TestKey {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const der = publicKey.export({ format: "der", type: "spki" });

  return {
    pem: privateKey.export({ format: "pem", type: "pkcs8" }),
    raw: new Uint8Array(der.subarray(spki.length)),
  };
}

/** The environment without a hook's `GIT_DIR` and kin, which would aim git at this checkout. */
function clean(): Record<string, string | undefined> {
  return Object.fromEntries(
    Object.keys(process.env)
      .filter((name) => !name.startsWith("GIT_"))
      .map((name) => [name, process.env[name]]),
  );
}

function git(cwd: string, args: readonly string[]): Buffer {
  const done = Bun.spawnSync(["git", ...args], { cwd, env: clean() });

  if (done.exitCode !== 0) throw new Error(done.stderr.toString());

  return done.stdout;
}

interface Plant {
  readonly repo: string;
  readonly remote: string;
}

/** A checkout with `meter` committed as source and build, and an empty bare remote. */
async function plant(): Promise<Plant> {
  const root = await mkdtemp(join(tmpdir(), "publish-"));
  const repo = join(root, "repo");
  const remote = join(root, "remote.git");
  const profiles = join(repo, "profiles");

  await mkdir(profiles, { recursive: true });
  await writeFile(join(repo, "README.md"), "source, never published\n");
  await writeFile(join(profiles, "meter.ts"), `export default ${JSON.stringify(meter)};\n`);
  await buildProfiles(profiles, profiles);
  git(root, ["init", "-q", "--bare", remote]);
  git(repo, ["init", "-q", "-b", "master"]);
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "-q", "-m", "profiles"]);

  return { repo, remote };
}

function published(remote: string, path: string): string {
  return git(remote, ["show", `profiles-dist:${path}`]).toString();
}

/** The first entry's signature in a published index. */
function signatureIn(index: string): string {
  return /"signature": "(?<hex>[0-9a-f]*)"/u.exec(index)?.groups?.["hex"] ?? "";
}

/** Raw Ed25519 public key bytes as a key object. */
function publicKeyOf(raw: Uint8Array): KeyObject {
  return createPublicKey({ key: Buffer.concat([spki, raw]), format: "der", type: "spki" });
}

/** `at` published with `key`, which the core is taken to compile in through the `keys` seam. */
function signedBy(at: Plant, key: TestKey): Publication {
  return { ...at, signingKey: key.pem, keys: { active: key.raw, backup: testKey().raw } };
}

/** The reason `publishProfiles` refused, or "" when it published. */
async function refusal(publication: Publication): Promise<string> {
  try {
    await publishProfiles(publication);

    return "";
  } catch (error) {
    return String(error);
  }
}

function branches(remote: string): string {
  return git(remote, ["branch", "--list"]).toString();
}

/** Renames `meter` in its source. */
async function rename(at: Plant, name: string): Promise<void> {
  const text = `export default ${JSON.stringify({ ...meter, name })};\n`;

  await writeFile(join(at.repo, "profiles", "meter.ts"), text);
}

test("publish pushes only the signed output to an orphan profiles-dist branch", async () => {
  const at = await plant();
  const key = testKey();

  await publishProfiles(signedBy(at, key));

  const profile = published(at.remote, "meter.json");
  const index: unknown = JSON.parse(published(at.remote, "index.json"));
  const signature = signatureIn(published(at.remote, "index.json"));
  const head = git(at.remote, ["rev-parse", "profiles-dist"]).toString();

  expect(git(at.remote, ["ls-tree", "--name-only", "profiles-dist"]).toString()).toBe(
    "index.json\nmeter.json\n",
  );
  expect(git(at.remote, ["rev-list", "--max-parents=0", "profiles-dist"]).toString()).toBe(head);
  expect(index).toEqual({
    profiles: [
      {
        id: "meter",
        version: "1.0.0",
        schema: 1,
        requires: ["modbus", "u16"],
        sha256: createHash("sha256").update(profile).digest("hex"),
        url: "meter.json",
        signature,
      },
    ],
  });
  expect(
    verify(null, Buffer.from(profile), publicKeyOf(key.raw), Buffer.from(signature, "hex")),
  ).toBe(true);
});

test("a bundle that does not verify against the compiled profile key is not pushed", async () => {
  const at = await plant();
  const reason = await refusal({ ...signedBy(at, testKey()), signingKey: testKey().pem });

  expect({ reason, branches: branches(at.remote) }).toEqual({
    reason: "Error: meter.json does not verify against the compiled profile key",
    branches: "",
  });
});

test("without a compiled profile key nothing is published, pending the key ceremony", async () => {
  const at = await plant();
  const reason = await refusal({ ...signedBy(at, testKey()), keys: undefined });

  expect({ reason, branches: branches(at.remote) }).toEqual({
    reason: "Error: the core compiles in no profile key yet: publishing waits for the key ceremony",
    branches: "",
  });
});

test("a publish with nothing new pushes no commit", async () => {
  const at = await plant();
  const publication = signedBy(at, testKey());
  const first = await publishProfiles(publication);
  const second = await publishProfiles(publication);
  const head = git(at.remote, ["rev-parse", "profiles-dist"]).toString().trim();

  expect({ second, head }).toEqual({ second: undefined, head: first ?? "" });
});

test("a profile changed since its last commit is not published", async () => {
  const at = await plant();

  await rename(at, "Meter 2");

  expect({ reason: await refusal(signedBy(at, testKey())), branches: branches(at.remote) }).toEqual(
    {
      reason: "Error: profiles/ differs from its commit: commit the build first",
      branches: "",
    },
  );
});

test("a changed profile, built and committed, publishes on top at its bumped version", async () => {
  const at = await plant();
  const publication = signedBy(at, testKey());
  const profiles = join(at.repo, "profiles");

  await publishProfiles(publication);
  await rename(at, "Meter 2");
  await buildProfiles(profiles, profiles);
  git(at.repo, ["commit", "-qam", "rename"]);
  await publishProfiles(publication);

  const profile: unknown = JSON.parse(published(at.remote, "meter.json"));
  const commits = git(at.remote, ["rev-list", "--count", "profiles-dist"]).toString();

  expect({ commits, profile }).toEqual({
    commits: "2\n",
    profile: { ...meter, name: "Meter 2", version: "1.0.1" },
  });
});

test("publish ignores a GIT_DIR in its environment, as a git hook sets it", async () => {
  const at = await plant();
  const decoy = join(at.repo, "..", "decoy.git");

  git(at.repo, ["init", "-q", "--bare", decoy]);
  process.env["GIT_DIR"] = decoy;

  try {
    await publishProfiles(signedBy(at, testKey()));
  } finally {
    delete process.env["GIT_DIR"];
  }

  expect({ decoy: branches(decoy), remote: branches(at.remote) }).toEqual({
    decoy: "",
    remote: "  profiles-dist\n",
  });
});
