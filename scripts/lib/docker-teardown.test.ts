/**
 * The timescaledb image declares VOLUME, so every `docker run` of it mints an anonymous volume that
 * `docker rm -f` leaves behind (~180 MB per gate run). The real-docker tests inspect only the volume
 * of the container they create, so they never touch another volume on the host and cannot race a
 * parallel gate run.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { removeContainerArgs } from "./docker-teardown";

const IMAGE = "ghcr.io/sunreye/timescaledb:pg17-ts2.28.2";

const docker = (...args: string[]) =>
  Bun.spawnSync(["docker", ...args], { stdout: "pipe", stderr: "pipe" });
const dockerReady = docker("image", "inspect", IMAGE).exitCode === 0;

describe("removeContainerArgs", () => {
  test("forces removal and takes the anonymous volumes with it", () => {
    expect(removeContainerArgs("sunreye-ci-db")).toEqual(["rm", "-fv", "sunreye-ci-db"]);
  });
});

describe.skipIf(!dockerReady)("teardown against a real container", () => {
  const created: { name: string; volume: string }[] = [];

  /** `docker create` mints the image's anonymous volume without starting postgres or touching a port. */
  function create(): { name: string; volume: string } {
    const name = `sunreye-teardown-test-${process.pid}-${created.length}`;
    const made = docker("create", "--name", name, "--network", "none", IMAGE);
    expect(made.exitCode).toBe(0);
    const volume = docker("inspect", "-f", "{{range .Mounts}}{{.Name}}{{end}}", name)
      .stdout.toString()
      .trim();
    created.push({ name, volume });
    expect(volume).not.toBe("");
    return { name, volume };
  }

  const volumeExists = (volume: string) => docker("volume", "inspect", volume).exitCode === 0;

  afterEach(() => {
    for (const { name, volume } of created.splice(0)) {
      docker("rm", "-f", name);
      docker("volume", "rm", "-f", volume);
    }
  });

  test("the command scripts/ci runs leaves no volume behind", () => {
    const { name, volume } = create();
    expect(volumeExists(volume)).toBe(true);

    const cli = Bun.spawnSync(["bun", "scripts/lib/docker-teardown.ts", name], {
      stdout: "pipe",
      stderr: "pipe",
    });

    expect(cli.exitCode).toBe(0);
    expect(volumeExists(volume)).toBe(false);
  }, 30_000);
});
