import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

/**
 * Where the Rust gate is wired in. What each step decides is proven in rust-gate.test.ts and
 * coverage-floor.test.ts; these prove the steps are reachable from the two entry points.
 */

const manifest = JSON.parse(readFileSync("package.json", "utf8")) as {
  scripts: Record<string, string>;
};
const ci = readFileSync("scripts/ci", "utf8");
const ciCommands = ci
  .split("\n")
  .map((line) => line.trim())
  .filter((line) => line && !line.startsWith("#"));

describe("bun run test", () => {
  // `&&` is what makes a red Rust test a red `bun run test`: the shell stops on the first failure.
  test("runs the Rust workspace tests and fails when they fail", () => {
    const steps = (manifest.scripts.test ?? "").split("&&").map((s) => s.trim());
    expect(steps.some((s) => s.includes("bun test"))).toBe(true);
    expect(steps).toContain("cargo test --workspace");
  });
});

describe("Rust coverage scripts", () => {
  test("coverage is written where the floor reads it", () => {
    expect(manifest.scripts["test:coverage:rust"]).toContain(
      "cargo llvm-cov --workspace --lcov --output-path coverage/rust-lcov.info",
    );
    expect(manifest.scripts["test:floor:rust"]).toBe("bun scripts/coverage-floor.ts --rust");
  });
});

describe("scripts/ci", () => {
  test("stops on the first failing command", () => {
    expect(ci).toContain("set -euo pipefail");
  });

  test("runs the Rust gate, then Rust coverage and its floor, none of them forgiven", () => {
    const wanted = ["scripts/rust-gate", "bun run test:coverage:rust", "bun run test:floor:rust"];
    for (const command of wanted) {
      const line = ciCommands.find((l) => l.includes(command));
      expect(line, command).toBeDefined();
      expect(line).not.toContain("||");
    }
    const at = (command: string) => ciCommands.findIndex((l) => l.includes(command));
    expect(at("scripts/rust-gate")).toBeLessThan(at("bun run test:coverage:rust"));
    expect(at("bun run test:coverage:rust")).toBeLessThan(at("bun run test:floor:rust"));
  });

  // The coverage run executes every Rust test and fails when one fails, so a second run is waste.
  test("runs each Rust test once, under Rust coverage", () => {
    const runsRustTests = (l: string) =>
      /\bcargo (llvm-cov|test|nextest)\b/.test(l) ||
      /\bbun run (test|test:coverage:rust)(\s|$)/.test(l);
    expect(ciCommands.filter(runsRustTests)).toEqual([
      expect.stringContaining("bun run test:coverage:rust"),
    ]);
    expect(readFileSync("scripts/rust-gate", "utf8")).not.toMatch(
      /\bcargo (llvm-cov|test|nextest)\b/,
    );
  });

  test("builds for Android after the Rust gate, unforgiven", () => {
    const at = (command: string) => ciCommands.findIndex((l) => l.includes(command));
    const line = ciCommands[at("scripts/target-gate")];
    expect(line, "scripts/target-gate").toBeDefined();
    expect(line).not.toContain("||");
    expect(at("scripts/target-gate")).toBeGreaterThan(at("scripts/rust-gate"));
  });
});
