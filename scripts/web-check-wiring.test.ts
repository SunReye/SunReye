import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

/**
 * `apps/web` is checked and compiled by rsvelte. What a Svelte or type error is stays the tools'
 * call; these pin the wiring that fails silently when it drifts: a checker that falls back to
 * `tsc`, a second Svelte plugin that compiles every component twice, a gate that never runs the
 * web check.
 */

type Manifest = {
  scripts?: Record<string, string>;
  devDependencies?: Record<string, string>;
  overrides?: Record<string, string>;
};

const read = (path: string): Manifest => JSON.parse(readFileSync(path, "utf8"));
const web = read("apps/web/package.json");

describe("web check", () => {
  test.each(["check", "check:watch"])("%s runs rsvelte-check on tsrs", (name) => {
    const script = web.scripts?.[name] ?? "";
    expect(script).toContain("rsvelte-check");
    // --tsgo makes a missing checker an error instead of a quiet fall back to the workspace tsc.
    expect(script).toContain("--tsgo");
    expect(script).toContain("TSGO_BIN=tsrs");
    expect(script).not.toMatch(/(^|[\s&])svelte-check\b/);
  });

  test("check starts from an empty shadow directory", () => {
    // rsvelte writes one .tsx per component and never prunes: a deleted component keeps failing.
    expect(web.scripts?.check).toContain("rm -rf .svelte-check");
  });

  test("scripts/ci runs the web check", () => {
    expect(readFileSync("scripts/ci", "utf8")).toContain("bun run --cwd apps/web check");
  });
});

describe("web compile", () => {
  test("the rsvelte plugin replaces the official one, including inside SvelteKit", () => {
    expect(web.devDependencies?.["@rsvelte/svelte-check"]).toBeDefined();
    expect(web.devDependencies?.["@rsvelte/vite-plugin-svelte"]).toBeDefined();
    expect(web.devDependencies).not.toHaveProperty("svelte-check");
    expect(read("package.json").overrides?.["@sveltejs/vite-plugin-svelte"]).toMatch(
      /^npm:@rsvelte\/vite-plugin-svelte@/,
    );
  });

  test("no Svelte plugin is listed next to sveltekit()", () => {
    const config = readFileSync("apps/web/vite.config.ts", "utf8");
    expect(config).not.toMatch(/vite-plugin-svelte/);
  });

  test("svelte.config.js takes vitePreprocess from rsvelte", () => {
    const config = readFileSync("apps/web/svelte.config.js", "utf8");
    expect(config).toContain('from "@rsvelte/vite-plugin-svelte"');
    expect(config).not.toContain("@sveltejs/vite-plugin-svelte");
  });
});
