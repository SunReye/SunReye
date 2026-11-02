import { describe, expect, test } from "bun:test";
import { Glob } from "bun";
import { readFileSync } from "node:fs";

/**
 * `check-types` runs tsrs. What a type error is stays the compiler's call; these pin that every
 * workspace asks tsrs, never emits, and that `typescript` stays for the tools that import it.
 */

type Manifest = {
  scripts?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

const read = (path: string): Manifest => JSON.parse(readFileSync(path, "utf8"));

const workspaces = [...new Glob("{apps,packages}/*/package.json").scanSync(".")]
  .map((path) => ({ path, manifest: read(path) }))
  .filter(({ manifest }) => manifest.scripts?.["check-types"] !== undefined);

describe("check-types", () => {
  test("finds the workspaces that type-check", () => {
    expect(workspaces.map(({ path }) => path).sort()).toEqual([
      "apps/appliance-cli/package.json",
      "apps/server/package.json",
      "packages/auth/package.json",
      "packages/contracts/package.json",
      "packages/env/package.json",
      "packages/inverter-core/package.json",
      "packages/profile-sdk/package.json",
    ]);
  });

  test.each(workspaces.map(({ path, manifest }) => [path, manifest] as const))(
    "%s runs tsrs without emitting",
    (_path, manifest) => {
      expect(manifest.scripts?.["check-types"]).toBe("tsrs -p . --noEmit");
    },
  );

  // With `--noEmit`, tsrs still runs declaration-emit checks (TS2883 on types that name a
  // hoisted dependency); tsc 6 does not. Nothing emits from these workspaces, so the options go.
  test.each(workspaces.map(({ path }) => [path.replace("package.json", "tsconfig.json")] as const))(
    "%s sets no emit options",
    (path) => {
      const { compilerOptions = {} } = JSON.parse(
        readFileSync(path, "utf8").replace(/^\s*\/\/.*$/gm, ""),
      ) as { compilerOptions?: Record<string, unknown> };
      for (const option of [
        "composite",
        "declaration",
        "declarationMap",
        "emitDeclarationOnly",
        "outDir",
      ]) {
        expect(compilerOptions, option).not.toHaveProperty(option);
      }
    },
  );

  test("tsrs is a root devDependency and typescript stays", () => {
    const root = read("package.json");
    expect(root.devDependencies?.tsrs).toBeDefined();
    expect(root.devDependencies?.typescript).toBeDefined();
  });
});
