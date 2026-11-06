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

describe("bare test scripts", () => {
  // The per-PR gate's unit step: the same files and flags as `bun run test`, minus coverage and cargo.
  test("test:unit runs the workspace TypeScript tests in parallel, with no coverage", () => {
    const unit = manifest.scripts["test:unit"] ?? "";
    expect(unit).toContain("bun test --parallel apps/*/src packages/*/src ./scripts");
    expect(unit).not.toMatch(/coverage|cargo/);
  });
});

describe("test:rust", () => {
  // nextest runs the same 710 tests as `cargo test --workspace` (no doctest exists) in a fifth of the time.
  test("runs the whole workspace under nextest and names the install when it is missing", () => {
    const script = manifest.scripts["test:rust"] ?? "";
    expect(script).toContain("cargo nextest run --workspace");
    expect(script).toContain("cargo install cargo-nextest --locked");
    expect(script).not.toMatch(/llvm-cov/);
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

  // Coverage runs every Rust test and fails when one fails, so the bare run is only for the per-PR
  // gate; scripts/ci-scope-gate.test.ts proves the two never both run in one mode.
  test("runs the Rust tests bare for a PR and under coverage for a train, never anywhere else", () => {
    const runsRustTests = (l: string) =>
      /\bcargo (llvm-cov|test|nextest)\b/.test(l) ||
      /\bbun run (test|test:rust|test:coverage:rust)(\s|$)/.test(l);
    expect(ciCommands.filter(runsRustTests)).toEqual([
      expect.stringContaining("bun run test:rust"),
      expect.stringContaining("bun run test:coverage:rust"),
    ]);
    expect(readFileSync("scripts/rust-gate", "utf8")).not.toMatch(
      /\bcargo (llvm-cov|test|nextest)\b/,
    );
  });
});
