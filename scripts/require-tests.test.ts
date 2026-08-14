import { describe, expect, test } from "bun:test";
import { isSourceFile, isTestFile, report, verdict } from "./require-tests";

describe("isSourceFile", () => {
  test("app and package sources count", () => {
    expect(isSourceFile("apps/server/src/cost.ts")).toBe(true);
    expect(isSourceFile("apps/web/src/lib/components/inverter/weather-tile.svelte")).toBe(true);
    expect(isSourceFile("packages/inverter-core/src/roles.ts")).toBe(true);
  });

  test("tests are not the source they cover", () => {
    expect(isSourceFile("apps/server/src/cost.test.ts")).toBe(false);
  });

  test("anything outside a workspace src tree is not source", () => {
    expect(isSourceFile("README.md")).toBe(false);
    expect(isSourceFile("apps/server/package.json")).toBe(false);
    expect(isSourceFile(".github/workflows/ci.yml")).toBe(false);
    expect(isSourceFile("apps/docs/src/content/guide.md")).toBe(false);
  });

  // Generated or declaration-only files carry no behaviour to test. Keeping the
  // list short and explicit is the point: an exemption is a decision, not a
  // default.
  test("generated and declaration-only files are exempt", () => {
    expect(isSourceFile("apps/web/src/lib/paraglide/messages.js")).toBe(false);
    expect(isSourceFile("packages/db/src/migrations/0001_init.sql")).toBe(false);
    expect(isSourceFile("apps/server/src/types.d.ts")).toBe(false);
    expect(isSourceFile("apps/web/src/app.d.ts")).toBe(false);
  });

  // Type-only modules and barrels have no runtime behaviour of their own; the
  // suite that covers the implementation covers them.
  test("type and barrel modules are exempt", () => {
    expect(isSourceFile("apps/web/src/lib/inverter/types.ts")).toBe(false);
    expect(isSourceFile("packages/inverter-core/src/index.ts")).toBe(false);
  });

  test("route and layout shells are exempt — they wire, they do not compute", () => {
    expect(isSourceFile("apps/web/src/routes/(app)/+layout.svelte")).toBe(false);
    expect(isSourceFile("apps/web/src/routes/+error.svelte")).toBe(false);
  });
});

describe("isTestFile", () => {
  test("colocated bun tests count", () => {
    expect(isTestFile("apps/server/src/cost.test.ts")).toBe(true);
    expect(isTestFile("apps/web/src/lib/api-payload.test.ts")).toBe(true);
    expect(isTestFile("scripts/require-tests.test.ts")).toBe(true);
  });

  test("a source file is not a test", () => {
    expect(isTestFile("apps/server/src/cost.ts")).toBe(false);
  });
});

describe("verdict", () => {
  test("source with a test in the same change passes", () => {
    const v = verdict(["apps/server/src/cost.ts", "apps/server/src/cost.test.ts"]);
    expect(v.ok).toBe(true);
    expect(v.sources).toEqual(["apps/server/src/cost.ts"]);
  });

  // The rule this whole file exists for: this project drives electrical
  // hardware, so behaviour cannot land untested.
  test("source with no test in the change fails, naming the files", () => {
    const v = verdict(["apps/server/src/cost.ts", "apps/server/src/inverter.ts"]);
    expect(v.ok).toBe(false);
    expect(v.sources).toEqual(["apps/server/src/cost.ts", "apps/server/src/inverter.ts"]);
  });

  test("a docs-only or config-only change passes — there is nothing to cover", () => {
    expect(verdict(["README.md", "apps/server/package.json"]).ok).toBe(true);
  });

  test("an empty change passes", () => {
    expect(verdict([]).ok).toBe(true);
  });

  test("deleting a source file alongside its test passes", () => {
    expect(verdict(["apps/server/src/old.ts", "apps/server/src/old.test.ts"]).ok).toBe(true);
  });

  test("a test anywhere in the change satisfies the rule", () => {
    // Cross-package is legitimate: a server change is often proven through the
    // package that owns the behaviour.
    expect(
      verdict(["apps/server/src/cost.ts", "packages/inverter-core/src/roles.test.ts"]).ok,
    ).toBe(true);
  });
});

describe("report", () => {
  test("a passing verdict exits 0 and says nothing", () => {
    const lines: string[] = [];
    expect(report(verdict(["README.md"]), (l) => lines.push(l))).toBe(0);
    expect(lines).toEqual([]);
  });

  test("a failing verdict exits 1 and names every uncovered file", () => {
    const lines: string[] = [];
    const code = report(verdict(["apps/server/src/cost.ts"]), (l) => lines.push(l));
    expect(code).toBe(1);
    expect(lines.join("\n")).toContain("apps/server/src/cost.ts");
    expect(lines.join("\n")).toContain("TDD gate");
  });
});
