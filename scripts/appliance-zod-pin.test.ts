import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

/**
 * The appliance CLI runs from the Nix store, where the workspace's node_modules
 * does not exist — so its one runtime dependency is fetched by Nix against a
 * pinned version and hash (`nixos/modules/sunreye/setup-cli-package.nix`).
 *
 * That is a second pin for a package the workspace already pins, and a second
 * pin drifts: bump the catalog, and the box keeps shipping the old zod while
 * every test here runs against the new one. The failure would surface as a
 * runtime error on a box nobody can reach, which is the worst place we have.
 */
const PACKAGE_NIX = "nixos/modules/sunreye/setup-cli-package.nix";

describe("appliance zod pin", () => {
  const nix = readFileSync(PACKAGE_NIX, "utf8");

  test("matches the version the workspace actually resolved", () => {
    const pinned = /zodVersion = "([^"]+)"/.exec(nix)?.[1];
    // The lockfile rather than node_modules: it is the resolution itself, and it
    // is readable in a fresh checkout that has not installed anything.
    const resolved = /"zod": \["zod@([^"]+)"/.exec(readFileSync("bun.lock", "utf8"))?.[1];

    expect(resolved).toBeDefined();
    expect(pinned).toBe(resolved);
  });

  // The hash is what makes the fetch a fetch and not a download; without it the
  // pin above is decoration.
  test("carries a fixed-output hash", () => {
    expect(nix).toMatch(/hash = "sha256-[A-Za-z0-9+/=]+";/);
  });
});
