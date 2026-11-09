import { expect, test } from "bun:test";
import { createHash, generateKeyPairSync, verify } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Build, elf } from "./elf-fixture.ts";
import { git, tryGit } from "./git.ts";
import { type Binary, type Builder, type Release, release } from "./release-steps.ts";

const addonManifest = "name: SunReye 5\nversion: 5.0.0\nslug: sunreye_v5\n";

interface Stand {
  readonly root: string;
  readonly repo: string;
  /** Receives the tag, standing in for the code repository. */
  readonly remote: string;
  /** Stands in for the Home Assistant add-on repository. */
  readonly addons: string;
}

function commit(repo: string, message: string): void {
  git(repo, ["-c", "user.name=T", "-c", "user.email=t@example.invalid", "commit", "-qm", message]);
}

/** A checkout ready for 5.0.0, an empty remote, and an add-on repository with v3's add-on. */
async function stand(): Promise<Stand> {
  const root = await mkdtemp(join(tmpdir(), "release-"));
  const repo = join(root, "repo");
  const remote = join(root, "remote.git");
  const addons = join(root, "addons.git");
  const seed = join(root, "seed");

  await mkdir(join(repo, "packaging/addon"), { recursive: true });
  await writeFile(join(repo, "Cargo.toml"), '[workspace.package]\nversion = "5.0.0"\n');
  await writeFile(join(repo, "packaging/addon/config.yaml"), addonManifest);
  await writeFile(join(repo, "packaging/sunreye.service"), "[Service]\n");
  git(repo, ["init", "-q", "-b", "v5"]);
  git(repo, ["add", "-A"]);
  commit(repo, "feat(core): poll inverters");
  git(root, ["init", "-q", "--bare", remote]);
  git(root, ["init", "-q", "--bare", addons]);
  await mkdir(join(seed, "sunreye"), { recursive: true });
  await writeFile(join(seed, "repository.yaml"), "name: SunReye Add-ons\n");
  await writeFile(join(seed, "sunreye/config.yaml"), "slug: sunreye\n");
  git(seed, ["init", "-q", "-b", "master"]);
  git(seed, ["add", "-A"]);
  commit(seed, "v3");
  git(seed, ["push", "-q", addons, "master"]);

  return { root, repo, remote, addons };
}

/** A builder writing ELF images of `build`'s kind, pushing nothing anywhere, and recording what
 * the release asked of it, as does the release's `publish`. */
interface Fake {
  readonly builder: Builder;
  readonly record: (call: string) => void;
  readonly calls: () => readonly string[];
}

function fake(build: Omit<Build, "arch"> = {}): Fake {
  const calls: string[] = [];

  const record = (call: string): void => {
    calls.push(call);
  };

  const binaries = (version: string, dist: string): Promise<Binary[]> => {
    record("binaries");

    return Promise.all(
      (["amd64", "arm64"] as const).map(async (arch) => {
        const path = join(dist, `sunreye-${version}-linux-${arch}`);

        await writeFile(path, elf({ ...build, arch }));

        return { arch, path };
      }),
    );
  };

  const images = (version: string, push: boolean): Promise<string[]> => {
    record(push ? "push images" : "build images");

    const digest = `sha256:${"0".repeat(64)}`;

    return Promise.resolve(push ? [`registry.invalid/sunreye-v5:${version}@${digest}`] : []);
  };

  const close = (): Promise<void> => {
    record("close");

    return Promise.resolve();
  };

  return { builder: { binaries, images, close }, record, calls: () => calls };
}

interface Key {
  readonly private: string;
  readonly public: string;
}

/** A key pair made for one test, never a release key. */
function testKey(): Key {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");

  return {
    private: privateKey.export({ format: "pem", type: "pkcs8" }),
    public: publicKey.export({ format: "pem", type: "spki" }),
  };
}

/** A release of `at`, signed with `key`, published to the stand-ins. */
function releaseOf(at: Stand, stub: Fake, key?: Key): Release {
  return {
    repo: at.repo,
    dist: join(at.root, "dist"),
    builder: stub.builder,
    releaseKey: key?.public,
    signingKey: key?.private,
    remote: at.remote,
    addon: { remote: at.addons, branch: "master" },
    publish: (plan, files) => {
      // The add-on must not offer a version before its release exists.
      if (addonFile(at, "sunreye_v5/config.yaml") !== undefined) throw new Error("add-on first");

      stub.record(`publish ${plan.tag}: ${files.join(" ")}`);

      return Promise.resolve();
    },
  };
}

function addonFile(at: Stand, path: string): string | undefined {
  const shown = tryGit(at.addons, ["show", `master:${path}`]);

  return shown.exitCode === 0 ? shown.stdout.toString() : undefined;
}

async function refusal(run: Release): Promise<string> {
  try {
    await release(run);

    return "";
  } catch (error) {
    return String(error);
  }
}

function tags(remote: string): string {
  return git(remote, ["tag", "--list"]);
}

const artifacts = [
  "CHANGELOG.md",
  "SHA256SUMS",
  "SHA256SUMS.sig",
  "images.txt",
  "sunreye-5.0.0-linux-amd64",
  "sunreye-5.0.0-linux-arm64",
  "sunreye.service",
];

test("without a release key every artifact is built and checked, then nothing is published", async () => {
  const at = await stand();
  const stub = fake();
  const reason = await refusal(releaseOf(at, stub));

  expect({
    reason,
    calls: stub.calls(),
    dist: (await readdir(join(at.root, "dist"))).toSorted(),
    tags: tags(at.remote),
    addon: addonFile(at, "sunreye_v5/config.yaml"),
  }).toEqual({
    reason: "Error: no release key yet: publishing waits for the key ceremony",
    calls: ["binaries", "build images", "close"],
    dist: [
      "CHANGELOG.md",
      "sunreye-5.0.0-linux-amd64",
      "sunreye-5.0.0-linux-arm64",
      "sunreye.service",
    ],
    tags: "",
    addon: undefined,
  });
});

test("a binary that is not static is refused before anything is signed", async () => {
  const at = await stand();
  const stub = fake({ interpreter: true });
  const reason = await refusal(releaseOf(at, stub, testKey()));

  expect({ reason, calls: stub.calls() }).toEqual({
    reason: [
      "Error: sunreye-5.0.0-linux-amd64: not static: it names an interpreter",
      "sunreye-5.0.0-linux-arm64: not static: it names an interpreter",
    ].join("\n"),
    calls: ["binaries", "close"],
  });
});

test("a signing key that is not the release key publishes nothing", async () => {
  const at = await stand();
  const stub = fake();
  const run = { ...releaseOf(at, stub, testKey()), signingKey: testKey().private };

  expect({ reason: await refusal(run), calls: stub.calls(), tags: tags(at.remote) }).toEqual({
    reason: "Error: the signing key is not the release key",
    calls: ["binaries", "build images", "close"],
    tags: "",
  });
});

test("a release signs every artifact, tags, publishes, and offers the add-on last", async () => {
  const at = await stand();
  const stub = fake();
  const key = testKey();

  await release(releaseOf(at, stub, key));

  const dist = join(at.root, "dist");
  const sums = await readFile(join(dist, "SHA256SUMS"));
  const signature = await readFile(join(dist, "SHA256SUMS.sig"));
  const signed = artifacts.filter((name) => !name.startsWith("SHA256SUMS"));

  const hashes = await Promise.all(
    signed.map(async (name) => {
      const hash = createHash("sha256").update(await readFile(join(dist, name)));

      return `${hash.digest("hex")}  ${name}\n`;
    }),
  );

  expect({
    dist: (await readdir(dist)).toSorted(),
    sums: sums.toString(),
    verifies: verify(null, sums, key.public, signature),
    images: await readFile(join(dist, "images.txt"), "utf8"),
    calls: stub.calls(),
    tag: git(at.remote, ["rev-parse", "v5.0.0^{commit}"]),
  }).toEqual({
    dist: artifacts,
    sums: hashes.join(""),
    verifies: true,
    images: `registry.invalid/sunreye-v5:5.0.0@sha256:${"0".repeat(64)}\n`,
    calls: [
      "binaries",
      "build images",
      "push images",
      `publish v5.0.0: ${artifacts.map((name) => join(dist, name)).join(" ")}`,
      "close",
    ],
    tag: git(at.repo, ["rev-parse", "HEAD"]),
  });
});

test("the add-on is published beside v3's, with its changelog", async () => {
  const at = await stand();

  await release(releaseOf(at, fake(), testKey()));

  expect({
    files: git(at.addons, ["ls-tree", "-r", "--name-only", "master"]),
    manifest: addonFile(at, "sunreye_v5/config.yaml"),
    changelog: addonFile(at, "sunreye_v5/CHANGELOG.md"),
  }).toEqual({
    files:
      "repository.yaml\nsunreye/config.yaml\nsunreye_v5/CHANGELOG.md\nsunreye_v5/config.yaml\n",
    manifest: addonManifest,
    changelog: await readFile(join(at.root, "dist/CHANGELOG.md"), "utf8"),
  });
});
