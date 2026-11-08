import { describe, expect, it } from "bun:test";
import { IMAGE, PLATFORMS, buildxArgs } from "./image-plan";

/** Every value following `flag`. */
const values = (args: string[], flag: string) =>
  args.flatMap((arg, i) => (arg === flag ? [args[i + 1] as string] : []));

describe("buildxArgs", () => {
  it("builds the core's Dockerfile for amd64 and arm64 from the repo root", () => {
    const args = buildxArgs("4.0.0");
    expect(args.slice(0, 2)).toEqual(["buildx", "build"]);
    expect(values(args, "--platform")).toEqual(["linux/amd64,linux/arm64"]);
    expect(values(args, "--file")).toEqual(["docker/rust-core/Dockerfile"]);
    expect(args.at(-1)).toBe(".");
  });

  it("tags the version and the major, and nothing else", () => {
    expect(values(buildxArgs("4.1.2"), "--tag")).toEqual([`${IMAGE}:4.1.2`, `${IMAGE}:4`]);
  });

  it("never tags latest and never pushes", () => {
    const args = buildxArgs("4.1.2");
    expect(args.join(" ")).not.toMatch(/latest|--push/);
    expect(args).toContain("--load");
  });

  it("builds only the platforms asked for", () => {
    expect(values(buildxArgs("4.0.0", ["linux/amd64"]), "--platform")).toEqual(["linux/amd64"]);
  });

  it("refuses a 3.x version, whose image the 3.x pipeline builds", () => {
    expect(() => buildxArgs("3.6.1")).toThrow("4.x");
  });

  it("refuses a malformed version", () => {
    expect(() => buildxArgs("4.0.0-beta.1")).toThrow("not a release version");
  });

  it("builds both published architectures by default", () => {
    expect(PLATFORMS).toEqual(["linux/amd64", "linux/arm64"]);
  });
});
