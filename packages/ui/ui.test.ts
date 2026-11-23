// The package as npm would ship it (ADR 25): every component compiles from the tarball, imports
// only what it ships or declares, and the sheet builds the kit's utilities under Tailwind.

import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdir, mkdtemp, readdir, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, normalize } from "node:path";
import { compile as tailwind } from "@tailwindcss/node";
import { compile } from "svelte/compiler";
import manifest from "./package.json" with { type: "json" };

const here = new URL(".", import.meta.url).pathname;

/** The kit components the builder uses (ADR 25), each a subpath of the package. */
const KIT = [
  "alert",
  "button",
  "calendar",
  "card",
  "checkbox",
  "dialog",
  "drawer",
  "dropdown-menu",
  "input",
  "item",
  "popover",
  "pressable",
  "separator",
  "slider",
  "spinner",
  "toggle",
  "toggle-group",
];

let out = "";
let installed = "";
let shipped: readonly string[] = [];

/**
 * Packs the package and installs the tarball where a consumer's resolver finds it, with the
 * dependencies the workspace installed for it: only those it declares.
 */
async function publish(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "sunreye-ui-"));
  const pack = Bun.spawnSync(["bun", "pm", "pack", "--quiet", "--destination", dir], { cwd: here });

  if (pack.exitCode !== 0) throw new Error(pack.stderr.toString());

  const tarball = join(dir, pack.stdout.toString().trim().split("/").pop() ?? "");

  installed = join(dir, "node_modules", "@sunreye", "ui");
  await mkdir(installed, { recursive: true });
  Bun.spawnSync(["tar", "-xzf", tarball, "-C", installed, "--strip-components=1"]);
  await symlink(join(here, "node_modules"), join(installed, "node_modules"));
  await symlink(
    join(here, "node_modules", "tailwindcss"),
    join(dir, "node_modules", "tailwindcss"),
  );

  return dir;
}

beforeAll(async () => {
  out = await publish();
  shipped = (await readdir(installed, { recursive: true, encoding: "utf8" })).filter(
    (file) => !file.startsWith("node_modules") && /\.(svelte|ts|css)$/u.test(file),
  );
});

afterAll(async () => {
  await rm(out, { recursive: true, force: true });
});

/** The package a bare specifier names: `@scope/name` or `name`. */
function packageOf(specifier: string): string {
  const parts = specifier.split("/");

  return (specifier.startsWith("@") ? parts.slice(0, 2) : parts.slice(0, 1)).join("/");
}

/** The shipped files a consumer's bundler compiles: all but the sheet. */
function scripts(): readonly string[] {
  return shipped.filter((file) => !file.endsWith(".css"));
}

/** The JavaScript a consumer's bundler sees for a shipped file. */
async function script(file: string): Promise<string> {
  const source = await Bun.file(join(installed, file)).text();

  if (file.endsWith(".svelte")) return compile(source, { filename: file }).js.code;

  return new Bun.Transpiler({ loader: "ts" }).transformSync(source);
}

test("each kit component, the helpers and the sheet resolve as a consumer imports them", () => {
  const subpaths = [
    ...KIT,
    "utils",
    "haptics",
    "low-power",
    "track-active",
    "motion/ease",
    "motion/token",
  ];

  for (const subpath of [...subpaths, "theme.css"]) {
    expect(Bun.resolveSync(`@sunreye/ui/${subpath}`, out)).toStartWith(installed);
  }
});

test("ships sources alone: no test, and every component compiles", async () => {
  expect(shipped.filter((file) => file.includes(".test."))).toEqual([]);
  expect(shipped.filter((file) => file.endsWith(".svelte")).length).toBeGreaterThan(KIT.length);

  await Promise.all(scripts().map((file) => script(file)));
});

test("a shipped file imports only what the package ships or declares", async () => {
  const declared = new Set([
    ...Object.keys(manifest.dependencies),
    ...Object.keys(manifest.peerDependencies),
  ]);

  /** What `file` imports that the package neither ships nor declares. */
  async function strays(file: string): Promise<string[]> {
    const found: string[] = [];

    for (const { path } of new Bun.Transpiler({ loader: "js" }).scanImports(await script(file))) {
      const ships = path.startsWith(".")
        ? shipped.includes(normalize(join(dirname(file), path)))
        : declared.has(packageOf(path));

      if (!ships) found.push(`${file} → ${path}`);
    }

    return found;
  }

  expect((await Promise.all(scripts().map((file) => strays(file)))).flat()).toEqual([]);
});

test("the sheet builds the kit's utilities and variants under a consumer's Tailwind", async () => {
  const css = `@import "tailwindcss";\n@import "@sunreye/ui/theme.css";\n`;
  const sheet = await tailwind(css, { base: out, onDependency: () => {} });
  // A build keeps every candidate it was given: one that adds no rule leaves the output as it was.
  let built = sheet.build([]);

  const candidates = [
    "bevel",
    "elevation-2",
    "glow-focus",
    "transition-press",
    "touch-hit",
    "bg-primary",
    "rounded-lg",
    "animate-spring-in",
    "data-open:animate-in",
    "touch:size-11",
    "dark:bg-input/30",
  ];

  const missing = candidates.filter((candidate) => {
    const before = built;

    built = sheet.build([candidate]);

    return built === before;
  });

  expect(missing).toEqual([]);
});
