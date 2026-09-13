import { describe, expect, test } from "bun:test";
import { factoryResetPlan, FACTORY_RESET_PATHS } from "./factory-reset";

/**
 * Returning the box to the state it left the flasher in, without a re-flash.
 *
 * This destroys the owner's entire measurement history — years of it, on a box
 * whose whole purpose is keeping that history — so the confirmation is not a
 * flag. `--yes` is one character from `--yez` and both are one shell-history
 * arrow-up from a command you meant to run on a different box. Typing the
 * hostname is the cheapest thing that cannot be done by accident.
 */

const HOST = "sr-ymfw060181";

describe("factoryResetPlan", () => {
  test("without a confirmation it explains and refuses", () => {
    const plan = factoryResetPlan({ hostname: HOST, confirm: undefined });

    expect(plan.proceed).toBe(false);
    // Refusing is useless if it does not say what the box is about to lose.
    expect(plan.message).toContain("measurement history");
    expect(plan.message).toContain(HOST);
  });

  test("the wrong hostname refuses, and says which box this is", () => {
    const plan = factoryResetPlan({ hostname: HOST, confirm: "sr-something-else" });

    expect(plan.proceed).toBe(false);
    expect(plan.message).toContain(HOST);
  });

  // The case this guard exists for: the right words, on the wrong machine.
  test("a confirmation that is merely close does not count", () => {
    for (const near of [`${HOST} `, HOST.toUpperCase(), HOST.slice(0, -1), `${HOST}x`]) {
      expect(factoryResetPlan({ hostname: HOST, confirm: near }).proceed).toBe(false);
    }
  });

  test("the box's own name proceeds", () => {
    const plan = factoryResetPlan({ hostname: HOST, confirm: HOST });

    expect(plan.proceed).toBe(true);
  });

  test("it never proceeds on a box whose hostname is unknown", () => {
    // An empty hostname would otherwise be confirmable with an empty string,
    // and `--confirm ""` is what a shell gives you for an unset variable.
    expect(factoryResetPlan({ hostname: "", confirm: "" }).proceed).toBe(false);
  });
});

describe("FACTORY_RESET_PATHS", () => {
  test("it clears the four things that make a box no longer factory-fresh", () => {
    expect(FACTORY_RESET_PATHS).toContain("/var/lib/tailscale");
    // The database AND the generated secrets live here; seed.nix regenerates
    // the secrets on the next boot.
    expect(FACTORY_RESET_PATHS).toContain("/var/lib/sunreye");
    expect(FACTORY_RESET_PATHS).toContain("/var/lib/secrets/console-password");
    // Without the claim marker the first-boot password window never reopens,
    // so a "reset" box would have no way in at all.
    expect(FACTORY_RESET_PATHS).toContain("/var/lib/secrets/console-claimed");
  });

  // local.nix is the owner's own configuration, not state this box generated —
  // a health webhook, an evcc block, a second SSH key. Wiping it is a separate
  // decision and theirs to make.
  test("it leaves the owner's own configuration alone", () => {
    for (const path of FACTORY_RESET_PATHS) {
      expect(path).not.toContain("local.nix");
    }
  });

  // /etc/nixos is a git repo and the box rebuilds from it. Deleting it would
  // leave a machine that cannot build its next system at all.
  test("it never removes the config tree the box rebuilds from", () => {
    expect(FACTORY_RESET_PATHS).not.toContain("/etc/nixos");
    expect(FACTORY_RESET_PATHS).not.toContain("/etc/nixos/flake.nix");
  });
});
