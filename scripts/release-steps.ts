// `bun run release` (ADR 13) step by step: plan, build and check every artifact, smoke the images,
// refuse without the release key (ADR 8), sign, then publish: images, tag, release, and the add-on
// last, so Supervisor never offers a version whose image is missing.

import { createHash, createPrivateKey, createPublicKey, sign, verify } from "node:crypto";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { type Arch, binaryProblems } from "./elf.ts";
import { git, tryGit } from "./git.ts";
import { type Plan, planRelease } from "./release-plan.ts";

/** A static binary in `dist`. */
export interface Binary {
  readonly arch: Arch;
  readonly path: string;
}

/** Builds the binaries and images; the seam the release is tested through. */
export interface Builder {
  /** Writes `sunreye-<version>-linux-<arch>` into `dist` for each architecture. */
  readonly binaries: (version: string, dist: string) => Promise<readonly Binary[]>;
  /** Runs the images behind the ingress stand-in (`bun run image:smoke`); throws on a failure. */
  readonly smoke: () => Promise<void>;
  /** Builds every image; when `push`, pushes them and returns each as `name:tag@digest`. */
  readonly images: (version: string, push: boolean) => Promise<readonly string[]>;
  readonly close: () => Promise<void>;
}

/** Where a release is built from and published to. */
export interface Release {
  /** The checkout whose HEAD is released. */
  readonly repo: string;
  /** Emptied, then filled with the artifacts. */
  readonly dist: string;
  readonly builder: Builder;
  /** The release key's public half, PEM; `undefined` until the key ceremony. */
  readonly releaseKey: string | undefined;
  /** The release key's private half, PKCS8 PEM. */
  readonly signingKey: string | undefined;
  /** The git remote that receives the tag. */
  readonly remote: string;
  /** The Home Assistant add-on repository and the branch Supervisor reads. */
  readonly addon: { readonly remote: string; readonly branch: string };
  /** Publishes the artifacts as the tag's release. */
  readonly publish: (plan: Plan, files: readonly string[]) => Promise<void>;
}

/** The add-on's directory in the add-on repository, beside v3's `sunreye/`. */
const addonDir = "sunreye_v5";

/** Refuses any binary that is not static, stripped and built for its architecture. */
async function checkBinaries(binaries: readonly Binary[]): Promise<void> {
  const checked = await Promise.all(
    binaries.map(async ({ arch, path }) => {
      const bytes = new Uint8Array(await readFile(path));

      return binaryProblems(bytes, arch).map((problem) => `${basename(path)}: ${problem}`);
    }),
  );

  const problems = checked.flat();

  if (problems.length > 0) throw new Error(problems.join("\n"));
}

/** Refuses a signing key whose signature the release key does not verify. */
function checkKeys(run: Release): string {
  const { releaseKey, signingKey } = run;

  if (releaseKey === undefined) {
    throw new Error("no release key yet: publishing waits for the key ceremony");
  }

  const probe = Buffer.from("sunreye release key probe");

  const verifies = (key: string): boolean =>
    verify(null, probe, createPublicKey(releaseKey), sign(null, probe, createPrivateKey(key)));

  const signed = signingKey !== undefined && verifies(signingKey);

  if (!signed) throw new Error("the signing key is not the release key");

  return signingKey;
}

/** Writes SHA256SUMS over `names` in `dist` and its Ed25519 signature; returns both names. */
async function signSums(dist: string, names: readonly string[], key: string): Promise<string[]> {
  const sha256 = async (name: string): Promise<string> =>
    createHash("sha256")
      .update(await readFile(join(dist, name)))
      .digest("hex");

  const lines = await Promise.all(names.map(async (name) => `${await sha256(name)}  ${name}\n`));
  const sums = Buffer.from(lines.join(""));

  await writeFile(join(dist, "SHA256SUMS"), sums);
  await writeFile(join(dist, "SHA256SUMS.sig"), sign(null, sums, createPrivateKey(key)));

  return ["SHA256SUMS", "SHA256SUMS.sig"];
}

/** Tags HEAD and pushes the tag. */
function tag(repo: string, remote: string, plan: Plan): void {
  git(repo, ["tag", "-a", plan.tag, "-m", `SunReye ${plan.version}`]);
  git(repo, ["push", "-q", remote, `refs/tags/${plan.tag}`]);
}

/** Commits the add-on's manifest and changelog to the add-on repository's branch. */
async function publishAddon(run: Release, plan: Plan): Promise<void> {
  const { remote, branch } = run.addon;
  const work = await mkdtemp(join(tmpdir(), "sunreye-addon-"));

  try {
    git(work, ["init", "-q", "-b", branch]);

    if (tryGit(work, ["fetch", "-q", remote, branch]).exitCode === 0) {
      git(work, ["reset", "-q", "--hard", "FETCH_HEAD"]);
    }

    const dir = join(work, addonDir);
    const earlier = await readFile(join(dir, "CHANGELOG.md"), "utf8").catch(() => "");

    await mkdir(dir, { recursive: true });
    await copyFile(join(run.repo, "packaging/addon/config.yaml"), join(dir, "config.yaml"));
    await writeFile(
      join(dir, "CHANGELOG.md"),
      earlier === "" ? plan.notes : `${plan.notes}\n${earlier}`,
    );
    git(work, ["add", "-A"]);
    git(work, ["commit", "-qm", `chore(addon): publish ${addonDir} ${plan.version}`]);
    git(work, ["push", "-q", remote, branch]);
  } finally {
    await rm(work, { recursive: true });
  }
}

/** Writes the binaries, the unit and the changelog into `dist`; returns their names. */
async function build(run: Release, plan: Plan): Promise<string[]> {
  const { dist, repo, builder } = run;

  await rm(dist, { recursive: true, force: true });
  await mkdir(dist, { recursive: true });
  await writeFile(join(dist, "CHANGELOG.md"), plan.notes);
  await copyFile(join(repo, "packaging/sunreye.service"), join(dist, "sunreye.service"));

  const binaries = await builder.binaries(plan.version, dist);

  await checkBinaries(binaries);
  // Nothing else runs the image smoke, so a release is where it cannot rot unnoticed (ADR 13).
  await builder.smoke();
  await builder.images(plan.version, false);

  return ["CHANGELOG.md", ...binaries.map(({ path }) => basename(path)), "sunreye.service"];
}

/**
 * Cuts the release HEAD names: builds and checks every artifact, then, with the release key,
 * signs and publishes them. Returns what it released.
 */
export async function release(run: Release): Promise<Plan> {
  const plan = await planRelease(run.repo);

  try {
    const built = await build(run, plan);
    const key = checkKeys(run);
    const images = await run.builder.images(plan.version, true);

    await writeFile(join(run.dist, "images.txt"), images.map((image) => `${image}\n`).join(""));

    const signed = ["images.txt", ...built].toSorted();
    const names = [...(await signSums(run.dist, signed, key)), ...signed].toSorted();

    tag(run.repo, run.remote, plan);
    await run.publish(
      plan,
      names.map((name) => join(run.dist, name)),
    );
    await publishAddon(run, plan);

    return plan;
  } finally {
    await run.builder.close();
  }
}
