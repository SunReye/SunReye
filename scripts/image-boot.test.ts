import { describe, expect, it } from "bun:test";
import { BOOT_PORT, bootRunArgs, holdsStore } from "./image-boot";

const run = { image: "img:4", name: "boot-1", volume: "vol-1", port: BOOT_PORT };

describe("bootRunArgs", () => {
  it("runs detached on the host network, which bridged containers on the LXC host cannot", () => {
    const args = bootRunArgs(run);
    expect(args.slice(0, 2)).toEqual(["run", "-d"]);
    expect(args.join(" ")).toContain("--network host");
    expect(args.join(" ")).not.toContain("-p ");
  });

  it("mounts the throwaway volume at /data on the amd64 image", () => {
    const args = bootRunArgs(run).join(" ");
    expect(args).toContain("--volume vol-1:/data");
    expect(args).toContain("--platform linux/amd64");
  });

  it("binds the asked port after the image, replacing the default command", () => {
    const args = bootRunArgs({ ...run, port: 8197 });
    expect(args.slice(-3)).toEqual(["img:4", "--listen", "0.0.0.0:8197"]);
  });

  it("uses a port that is neither the dev database's nor the core's own", () => {
    expect([5432, 8099]).not.toContain(BOOT_PORT);
  });

  it.each([5432, 8099])("refuses port %i", (port) => {
    expect(() => bootRunArgs({ ...run, port })).toThrow(String(port));
  });
});

describe("holdsStore", () => {
  it("finds the SQLite file in a tar listing of /data", () => {
    expect(holdsStore(["data/", "data/sunreye.db", "data/sunreye.db-wal"])).toBe(true);
  });

  it("is false for an empty data dir", () => {
    expect(holdsStore(["data/"])).toBe(false);
  });

  it("is not fooled by a similarly named file", () => {
    expect(holdsStore(["data/", "data/sunreye.db-wal", "data/old/sunreye.db"])).toBe(false);
  });
});
