import { imageTags } from "./image-tags";

export const IMAGE = "ghcr.io/sunreye/sunreye-server";
export const PLATFORMS = ["linux/amd64", "linux/arm64"];

/** `docker` arguments that build the core image locally: never `latest`, never pushed. */
export function buildxArgs(version: string, platforms: readonly string[] = PLATFORMS): string[] {
  const tags = imageTags(version);
  if (!version.startsWith("4."))
    throw new Error(`${version} is not a 4.x release: the core image is 4.x only`);
  return [
    "buildx",
    "build",
    "--platform",
    platforms.join(","),
    "--file",
    "docker/rust-core/Dockerfile",
    ...tags.flatMap((tag) => ["--tag", `${IMAGE}:${tag}`]),
    "--load",
    ".",
  ];
}
