// fallow-ignore-file coverage-gaps -- drives Docker and gh; `bun run release:rehearse` runs it against local stand-ins.
// `bun run release` (ADR 13): builds the static binaries, the multi-arch image and the add-on's
// images with Docker Buildx, signs them with the release key (ADR 8) and publishes 5.x to GHCR,
// a GitHub release and the add-on repository. Without `packaging/release.pub` it builds and checks
// everything, then refuses.

import { mkdtemp, readFile, rename, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Arch } from "./elf.ts";
import { git } from "./git.ts";
import type { Plan } from "./release-plan.ts";
import { type Binary, type Builder, release } from "./release-steps.ts";
import { run } from "./smoke.ts";

/** Where the images go. */
export interface Registry {
  /** Prefixes every image name, e.g. `ghcr.io/sunreye`. */
  readonly prefix: string;
  /** Pushes over plain HTTP, for a local stand-in. */
  readonly insecure: boolean;
}

const arches: readonly Arch[] = ["amd64", "arm64"];

/** Home Assistant's name for each architecture, which the add-on's image name carries. */
const addonArch: Readonly<Record<Arch, string>> = { amd64: "amd64", arm64: "aarch64" };

/** The add-on image's name for `arch`, as `packaging/addon/config.yaml` names it. */
export function addonImage(prefix: string, arch: Arch): string {
  return `${prefix}/sunreye-v5-addon-${addonArch[arch]}`;
}

const platforms = arches.map((arch) => `linux/${arch}`).join(",");

/** One release's Buildx builder. */
interface Buildx {
  readonly repo: string;
  readonly registry: Registry;
  readonly name: string;
  /** Creates the builder on first use. */
  readonly ready: () => Promise<string>;
}

async function build(on: Buildx, version: string, args: readonly string[]): Promise<void> {
  await on.ready();

  const docker = ["docker", "buildx", "build", "--builder", on.name, "--network", "host"];
  const dockerfile = ["--allow", "network.host", "-f", "packaging/Dockerfile"];

  await run([...docker, ...dockerfile, "--build-arg", `VERSION=${version}`, ...args, "."], on.repo);
}

async function exportBinaries(on: Buildx, version: string, dist: string): Promise<Binary[]> {
  // The core embeds the SPA's build (ADR 11).
  await run(["bun", "run", "--cwd", "apps/web", "build"], on.repo);

  const out = await mkdtemp(join(tmpdir(), "sunreye-binaries-"));
  const local = ["--output", `type=local,dest=${out}`];

  try {
    await build(on, version, ["--platform", platforms, "--target", "binary", ...local]);

    return await Promise.all(
      arches.map(async (arch) => {
        const path = join(dist, `sunreye-${version}-linux-${arch}`);

        await rename(join(out, `linux_${arch}`, "sunreye"), path);

        return { arch, path };
      }),
    );
  } finally {
    await rm(out, { recursive: true, force: true });
  }
}

/** The digest in a `--metadata-file`. */
function digestOf(metadata: string): string {
  const digest = /"containerimage\.digest":\s*"(?<d>sha256:[0-9a-f]{64})"/u.exec(metadata)
    ?.groups?.["d"];

  if (digest === undefined) throw new Error("buildx reported no image digest");

  return digest;
}

/** Pushes one image under `names`; returns `name:tag@digest` for each. */
async function pushImage(
  on: Buildx,
  version: string,
  names: readonly string[],
  args: readonly string[],
): Promise<string[]> {
  const meta = await mkdtemp(join(tmpdir(), "sunreye-image-"));
  const insecure = on.registry.insecure ? ",registry.insecure=true" : "";
  const tags = names.flatMap((tagged) => ["-t", tagged]);
  const output = ["--output", `type=image,push=true${insecure}`];

  try {
    await build(on, version, [
      ...args,
      ...tags,
      ...output,
      "--metadata-file",
      join(meta, "m.json"),
    ]);

    const digest = digestOf(await readFile(join(meta, "m.json"), "utf8"));

    return names.map((tagged) => `${tagged}@${digest}`);
  } finally {
    await rm(meta, { recursive: true, force: true });
  }
}

/** Builds the multi-arch core image and one add-on image per architecture; pushed when `push`. */
async function buildImages(on: Buildx, version: string, push: boolean): Promise<string[]> {
  const core = `${on.registry.prefix}/sunreye-v5`;

  const targets: (readonly [names: readonly string[], args: readonly string[]])[] = [
    [
      [`${core}:${version}`, `${core}:latest`],
      ["--platform", platforms, "--target", "core"],
    ],
    ...arches.map(
      (arch) =>
        [
          [`${addonImage(on.registry.prefix, arch)}:${version}`],
          ["--platform", `linux/${arch}`, "--target", "addon"],
        ] as const,
    ),
  ];

  const built = await Promise.all(
    targets.map(async ([names, args]) => {
      if (push) return pushImage(on, version, names, args);

      await build(on, version, [...args, "--output", "type=cacheonly"]);

      return [];
    }),
  );

  return built.flat();
}

/**
 * A Buildx builder of its own, created on first use and removed with its cache by `close`. Every
 * architecture compiles on the build host (packaging/Dockerfile), so one host builds them all.
 */
export function buildx(repo: string, registry: Registry): Builder {
  const name = `sunreye-release-${process.pid}`;
  let created: Promise<string> | undefined;

  // Bridged containers fail on some hosts; the build fetches crates over the host's network.
  const container = ["--driver", "docker-container", "--driver-opt", "network=host"];
  const entitled = ["--buildkitd-flags", "--allow-insecure-entitlement network.host"];
  const create = ["docker", "buildx", "create", "--name", name, ...container, ...entitled];

  const on: Buildx = {
    repo,
    registry,
    name,
    ready: () => {
      created ??= run([...create, "--bootstrap"]);

      return created;
    },
  };

  return {
    binaries: (version, dist) => exportBinaries(on, version, dist),
    smoke: async () => {
      await run(["bun", "run", "image:smoke"], repo);
    },
    images: (version, push) => buildImages(on, version, push),
    close: async () => {
      if (created !== undefined) await run(["docker", "buildx", "rm", "--force", name]);
    },
  };
}

/** Publishes the artifacts as the GitHub release of an already pushed tag. */
function githubRelease(repository: string) {
  return async (plan: Plan, files: readonly string[]): Promise<void> => {
    await run([
      "gh",
      "release",
      "create",
      plan.tag,
      "--repo",
      repository,
      "--verify-tag",
      "--title",
      `SunReye ${plan.version}`,
      "--notes",
      plan.notes,
      ...files,
    ]);
  };
}

if (import.meta.main) {
  const repo = new URL("..", import.meta.url).pathname;
  const registry = { prefix: "ghcr.io/sunreye", insecure: false };
  const manifest = await readFile(join(repo, "packaging/addon/config.yaml"), "utf8");

  if (!manifest.includes(`image: ${registry.prefix}/sunreye-v5-addon-{arch}\n`)) {
    throw new Error("packaging/addon/config.yaml names another image than the release pushes");
  }

  const keyPath = process.env["SUNREYE_RELEASE_KEY"];
  const origin = git(repo, ["remote", "get-url", "origin"]).trim();

  const plan = await release({
    repo,
    dist: join(repo, "dist"),
    builder: buildx(repo, registry),
    releaseKey: await readFile(join(repo, "packaging/release.pub"), "utf8").catch(() => void 0),
    signingKey: keyPath === undefined ? undefined : await readFile(keyPath, "utf8"),
    remote: origin,
    // The add-on repository is this one; Supervisor reads its default branch (ADR 13).
    addon: { remote: origin, branch: "master" },
    publish: githubRelease("SunReye/SunReye"),
  });

  process.stderr.write(`released ${plan.tag}\n`);
}
