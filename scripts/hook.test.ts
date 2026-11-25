import { expect, test } from "bun:test";
import { hookSteps, type Staged } from "./hook.ts";

function staged(files: readonly string[], built = true): Staged {
  return { files, crateName: (dir) => `name-of-${dir}`, exists: () => built };
}

const commands = (files: readonly string[], built = true) =>
  hookSteps(staged(files, built)).map((step) => step.run.join(" "));

test("nothing staged runs nothing", () => {
  expect(hookSteps(staged([]))).toEqual([]);
});

test("format and lint read only the staged files", () => {
  const run = commands(["apps/web/src/a.svelte", "packages/sdk/src/b.ts", "README.md"]);

  expect(run).toContain(
    "rsvelte format --check --no-error-on-unmatched-pattern apps/web/src/a.svelte packages/sdk/src/b.ts README.md",
  );
  expect(run).toContain("oxlint --deny-warnings apps/web/src/a.svelte packages/sdk/src/b.ts");
});

test("the bun tests are those the staged files reach", () => {
  expect(commands(["packages/sdk/src/b.ts"])).toContain("bun test --timeout 120000 --changed");
});

test("without a staged crate no cargo runs", () => {
  expect(commands(["packages/sdk/src/b.ts"]).filter((run) => run.startsWith("cargo"))).toEqual([]);
});

test("a staged crate is formatted and tested alone, and the WASM is rebuilt", () => {
  const run = commands(["crates/pv/src/lib.rs", "packages/catalogue/src/lib.rs"]);

  expect(run).toContain("cargo fmt --check -p name-of-crates/pv -p name-of-packages/catalogue");
  expect(run).toContain("cargo test --locked -p name-of-crates/pv -p name-of-packages/catalogue");
  expect(run).toContain("bun run --cwd packages/pv-wasm wasm");
  expect(run).toContain("bun run --cwd packages/sdk wasm");
  expect(run).toContain("bun test --timeout 120000 packages/pv-wasm packages/sdk");
});

test("the core's tests are left to the gate, which builds the SPA it embeds", () => {
  const steps = hookSteps({
    files: ["crates/core/src/main.rs"],
    crateName: () => "sunreye-core",
    exists: () => true,
  });

  expect(steps.map((step) => step.run.join(" ")).some((run) => run.startsWith("cargo test"))).toBe(
    false,
  );
});

test("missing WASM is built though no crate is staged", () => {
  expect(commands(["packages/sdk/src/b.ts"], false)).toContain("bun run --cwd packages/sdk wasm");
  expect(commands(["packages/sdk/src/b.ts"])).not.toContain("bun run --cwd packages/sdk wasm");
});

test("the whole-tree checks key on their inputs, so a green gate lets the hook skip them", () => {
  const tsrs = hookSteps(staged(["a.ts"])).find((step) => step.run[0] === "tsrs");

  expect(tsrs?.reads).toBeDefined();
});
