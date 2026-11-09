// fallow-ignore-file coverage-gaps -- needs Docker; run by hand with `bun run release:rehearse`.
// Rehearses `bun run release` end to end on a clone of HEAD with a key made for the run, a local
// registry, bare git repositories for the code and add-on repositories, and a directory for the
// GitHub release. Then checks what a user would: the signature with openssl, the hashes with
// sha256sum, both architectures in the registry, the amd64 binary and image serving, and the
// systemd unit. Nothing leaves the machine.

import { generateKeyPairSync } from "node:crypto";
import { copyFile, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { git } from "./git.ts";
import { buildx } from "./release.ts";
import { release } from "./release-steps.ts";
import { answers, type Check, report, run } from "./smoke.ts";

const REGISTRY = "127.0.0.1:5555";
const PREFIX = `localhost:5555/sunreye`;
const LISTEN = "127.0.0.1:18199";

/** Bare repositories standing in for the code and add-on repositories, the latter with v3's. */
async function remotes(root: string): Promise<Remotes> {
  const code = join(root, "code.git");
  const addons = join(root, "addons.git");
  const seed = join(root, "seed");

  git(root, ["init", "-q", "--bare", code]);
  git(root, ["init", "-q", "--bare", addons]);
  await mkdir(join(seed, "sunreye"), { recursive: true });
  await writeFile(join(seed, "repository.yaml"), "name: SunReye Add-ons\n");
  await writeFile(join(seed, "sunreye/config.yaml"), "slug: sunreye\n");
  git(seed, ["init", "-q", "-b", "master"]);
  git(seed, ["add", "-A"]);
  git(seed, ["commit", "-qm", "v3"]);
  git(seed, ["push", "-q", addons, "master"]);

  return { code, addons };
}

/** Platforms the registry lists for `image`, without the attestations Buildx adds as `unknown/unknown`. */
async function platforms(image: string): Promise<string> {
  const listed = await run(["docker", "buildx", "imagetools", "inspect", image]);

  return listed
    .split("\n")
    .flatMap((line) => /Platform:\s+(?<p>linux\S+)/u.exec(line)?.groups?.["p"] ?? [])
    .join(" ");
}

async function binaryChecks(dist: string, version: string): Promise<Check[]> {
  const amd64 = join(dist, `sunreye-${version}-linux-amd64`);
  const data = await mkdtemp(join(tmpdir(), "sunreye-data-"));

  const core = Bun.spawn([amd64], {
    env: { SUNREYE_DATA_DIR: data, SUNREYE_LISTEN: LISTEN },
    stderr: "ignore",
  });

  try {
    const described = await run(["file", amd64, join(dist, `sunreye-${version}-linux-arm64`)]);

    process.stderr.write(`${described}\n`);

    return [
      ["the amd64 binary serves the core", await answers(`http://${LISTEN}/openapi.json`, 100)],
    ];
  } finally {
    core.kill();
    await core.exited;
    await rm(data, { recursive: true });
  }
}

async function signatureChecks(dist: string, publicKey: string): Promise<Check[]> {
  const openssl = ["openssl", "pkeyutl", "-verify", "-pubin", "-inkey", publicKey, "-rawin"];
  const signed = ["-in", "SHA256SUMS", "-sigfile", "SHA256SUMS.sig"];
  const verified = await run([...openssl, ...signed], dist);
  const sums = await run(["sha256sum", "-c", "SHA256SUMS"], dist);

  return [
    ["openssl verifies SHA256SUMS against the release key", verified.includes("Verified")],
    ["sha256sum confirms every artifact", !sums.includes("FAILED")],
  ];
}

async function unitChecks(dist: string, version: string): Promise<Check[]> {
  const unit = join(dist, "..", "sunreye.service");
  const text = await readFile(join(dist, "sunreye.service"), "utf8");

  // verify needs ExecStart's binary to exist; the release's stands in for /usr/local/bin.
  const binary = join(dist, `sunreye-${version}-linux-amd64`);

  await writeFile(unit, text.replace("ExecStart=/usr/local/bin/sunreye", `ExecStart=${binary}`));

  const verified = Bun.spawnSync(["systemd-analyze", "verify", unit], { stderr: "pipe" });

  const complaints = verified.stderr
    .toString()
    .split("\n")
    .filter((line) => line.includes(basename(unit)));

  process.stderr.write(complaints.map((line) => `${line}\n`).join(""));

  return [
    ["systemd-analyze verifies the unit", verified.exitCode === 0 && complaints.length === 0],
  ];
}

async function imageChecks(dist: string, version: string): Promise<Check[]> {
  const core = `${PREFIX}/sunreye-v5:${version}`;
  const images = await readFile(join(dist, "images.txt"), "utf8");
  const docker = ["docker", "run", "-d", "--rm", "--network", "host", "--platform", "linux/amd64"];

  const id = await run([...docker, "-e", `SUNREYE_LISTEN=${LISTEN}`, "--tmpfs", "/data", core]);

  try {
    return [
      [
        "the core image holds amd64 and arm64",
        (await platforms(core)) === "linux/amd64 linux/arm64",
      ],
      [
        "the add-on images hold their architecture",
        (await platforms(`${PREFIX}/sunreye-v5-addon-amd64:${version}`)) === "linux/amd64" &&
          (await platforms(`${PREFIX}/sunreye-v5-addon-aarch64:${version}`)) === "linux/arm64",
      ],
      ["images.txt names every image by digest", images.split("\n").filter(Boolean).length === 4],
      [
        "the amd64 image pulled from the registry serves the core",
        await answers(`http://${LISTEN}/openapi.json`, 100),
      ],
    ];
  } finally {
    await run(["docker", "rm", "-f", id]);
    await run(["docker", "image", "rm", core]);
  }
}

interface Remotes {
  readonly code: string;
  readonly addons: string;
}

async function publishChecks(dist: string, published: string, at: Remotes): Promise<Check[]> {
  const addon = git(at.addons, ["ls-tree", "-r", "--name-only", "master"]);
  const beside = ["sunreye/config.yaml", "sunreye_v5/CHANGELOG.md", "sunreye_v5/config.yaml"];
  const [built, released] = await Promise.all([readdir(dist), readdir(published)]);

  return [
    ["the tag reached the code repository", git(at.code, ["tag", "--list"]) === "v5.0.0\n"],
    ["the add-on sits beside v3's", beside.every((path) => addon.includes(path))],
    [
      "the GitHub release stand-in holds every artifact",
      released.toSorted().join() === built.toSorted().join() && released.length === 7,
    ],
  ];
}

/** Releases `clone` to the stand-ins in `root`, signed with a key made for this run. */
async function rehearse(root: string, clone: string, at: Remotes): Promise<Check[]> {
  const dist = join(root, "dist");
  const published = join(root, "github-release");
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const releaseKey = publicKey.export({ format: "pem", type: "spki" });
  const publicPem = join(root, "release.pub");

  await writeFile(publicPem, releaseKey);

  const plan = await release({
    repo: clone,
    dist,
    builder: buildx(clone, { prefix: PREFIX, insecure: true }),
    releaseKey,
    signingKey: privateKey.export({ format: "pem", type: "pkcs8" }),
    remote: at.code,
    addon: { remote: at.addons, branch: "master" },
    publish: async (_, files) => {
      await mkdir(published, { recursive: true });
      await Promise.all(files.map((file) => copyFile(file, join(published, basename(file)))));
    },
  });

  return [
    ...(await binaryChecks(dist, plan.version)),
    ...(await signatureChecks(dist, publicPem)),
    ...(await unitChecks(dist, plan.version)),
    ...(await imageChecks(dist, plan.version)),
    ...(await publishChecks(dist, published, at)),
  ];
}

async function main(): Promise<number> {
  const repo = new URL("..", import.meta.url).pathname;
  const root = await mkdtemp(join(tmpdir(), "sunreye-rehearsal-"));
  const clone = join(root, "repo");

  git(root, ["clone", "-q", "--no-local", repo, clone]);
  await run(["bun", "install", "--frozen-lockfile"], clone);

  const at = await remotes(root);
  const pulled = Bun.spawnSync(["docker", "image", "inspect", "registry:2"]).exitCode !== 0;
  const registry = ["--network", "host", "-e", `REGISTRY_HTTP_ADDR=${REGISTRY}`, "registry:2"];
  const id = await run(["docker", "run", "-d", ...registry]);

  try {
    return report(await rehearse(root, clone, at));
  } finally {
    await run(["docker", "rm", "-f", id]);

    if (pulled) await run(["docker", "image", "rm", "registry:2"]);

    await rm(root, { recursive: true, force: true });
  }
}

process.exitCode = await main();
