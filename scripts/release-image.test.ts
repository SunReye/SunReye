import { describe, expect, it } from "bun:test";

const root = new URL("..", import.meta.url).pathname;

async function release(...args: string[]) {
  const proc = Bun.spawn([`${root}scripts/release-image`, ...args], {
    cwd: root,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { stdout, stderr, code };
}

describe("scripts/release-image", () => {
  it("prints the build it would run for both architectures, tagged 4.x.y and 4", async () => {
    const { stdout, code } = await release("4.2.1", "--dry-run");
    expect(code).toBe(0);
    expect(stdout.trim()).toBe(
      "docker buildx build --platform linux/amd64,linux/arm64 --file docker/rust-core/Dockerfile" +
        " --tag ghcr.io/sunreye/sunreye-server:4.2.1 --tag ghcr.io/sunreye/sunreye-server:4 --load .",
    );
  });

  it("builds one platform when asked", async () => {
    const { stdout } = await release("4.0.0", "--dry-run", "--platform", "linux/amd64");
    expect(stdout).toContain("--platform linux/amd64 ");
  });

  it("refuses a 3.x version before building anything", async () => {
    const { stderr, code } = await release("3.6.1", "--dry-run");
    expect(code).toBe(1);
    expect(stderr).toContain("4.x");
  });

  it("names its usage without a version", async () => {
    const { stderr, code } = await release("--dry-run");
    expect(code).toBe(2);
    expect(stderr).toContain("usage: scripts/release-image <version>");
  });
});
