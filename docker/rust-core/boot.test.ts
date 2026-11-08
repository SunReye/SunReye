/**
 * The core image booting for real: `scripts/image-boot-check` against the amd64 image, built first
 * by `scripts/release-image`. Outside every `src/` tree and `./scripts`, so `bun run test` stays
 * Docker-free; run with `bun run test:image`.
 *
 * Without Docker the test skips locally. In CI a missing Docker would make this layer silently
 * absent, so it fails instead (as `test:db` does).
 */
import { describe, expect, it } from "bun:test";
import { IMAGE } from "../../scripts/image-plan";

const root = new URL("../..", import.meta.url).pathname;
const VERSION = "4.0.0";

const dockerPresent = Bun.spawnSync(["docker", "version", "--format", "{{.Server.Version}}"], {
  stdout: "ignore",
  stderr: "ignore",
}).success;

if (!dockerPresent) {
  const message = "image boot check: no Docker daemon reachable.";
  if (process.env.CI) throw new Error(`${message} In CI this layer must never be skipped.`);
  console.warn(`${message} Skipping.`);
}

async function run(command: string[]) {
  const proc = Bun.spawn(command, { cwd: root, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { stdout, stderr, code };
}

(dockerPresent ? describe : describe.skip)("the core image", () => {
  it("builds for amd64, boots on an empty /data, answers at / and stores its SQLite file", async () => {
    const build = await run(["scripts/release-image", VERSION, "--platform", "linux/amd64"]);
    expect(build.code, build.stderr).toBe(0);
    const boot = await run(["scripts/image-boot-check", `${IMAGE}:${VERSION}`]);
    expect(boot.code, boot.stderr).toBe(0);
    expect(boot.stdout).toContain("boot check ok");
  }, 1_800_000);
});
