// The package as npm would ship it (ADR 25), loaded by a page with no build step: plain CSS alone.

import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { chromium, type Browser, type Page } from "playwright";

const here = new URL(".", import.meta.url).pathname;

let unpacked = "";
let entry = "";
let browser: Browser;
let lightPage: Page;
let darkPage: Page;

/** Packs the package and installs the tarball where a consumer's resolver finds it. */
async function publish(): Promise<string> {
  const out = await mkdtemp(join(tmpdir(), "sunreye-tokens-"));
  const pack = Bun.spawnSync(["bun", "pm", "pack", "--quiet", "--destination", out], { cwd: here });

  if (pack.exitCode !== 0) throw new Error(pack.stderr.toString());

  const tarball = join(out, pack.stdout.toString().trim().split("/").pop() ?? "");
  const installed = join(out, "node_modules", "@sunreye", "tokens");

  await mkdir(installed, { recursive: true });
  Bun.spawnSync(["tar", "-xzf", tarball, "-C", installed, "--strip-components=1"]);

  entry = Bun.resolveSync("@sunreye/tokens", out);

  await Bun.write(
    join(out, "page.html"),
    `<!doctype html><link rel="stylesheet" href="file://${entry}"><div class="glass-ambient"></div><div class="glass"></div><div class="canvas-chip"></div>`,
  );

  return out;
}

async function open(dark: boolean, reducedTransparency = false): Promise<Page> {
  const page = await browser.newPage();

  if (reducedTransparency) {
    const cdp = await page.context().newCDPSession(page);

    await cdp.send("Emulation.setEmulatedMedia", {
      features: [{ name: "prefers-reduced-transparency", value: "reduce" }],
    });
  }

  await page.goto(`file://${join(unpacked, "page.html")}`);

  if (dark) {
    await page.evaluate(() => {
      document.documentElement.classList.add("dark");
    });
  }

  return page;
}

const token = (page: Page, name: string) =>
  page.evaluate((n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim(), name);

/** The computed background alpha and backdrop filter of the element with `selector`. */
const surface = (page: Page, selector: string) =>
  page.evaluate((s) => {
    const element = document.querySelector(s);

    if (element === null) throw new Error(`No ${s} on the page.`);

    const style = getComputedStyle(element);
    const colour = style.backgroundColor;

    // After a modern colour's slash, or a legacy `rgba()`'s fourth number; none is opaque.
    const alpha =
      colour === "transparent"
        ? "0"
        : (/\/\s*([\d.e-]+)\s*\)$/u.exec(colour)?.[1] ??
          /^rgba\((?:[^,]+,){3}\s*([\d.e-]+)\s*\)$/u.exec(colour)?.[1]);

    return { alpha: alpha === undefined ? 1 : Number(alpha), blur: style.backdropFilter };
  }, selector);

const TAILWIND = /@(theme|utility|apply|custom-variant|source|tailwind|plugin)\b/u;

/** `file` under `root` and every sheet it imports, relative to it. */
async function sheets(
  root: string,
  file: string,
): Promise<readonly { readonly file: string; readonly text: string }[]> {
  const text = await Bun.file(join(root, file)).text();

  const imports = (text.match(/@import\s+"\.\/[^"]+"/gu) ?? []).map((rule) =>
    rule.replaceAll(/^@import\s+"\.\/|"$/gu, ""),
  );

  const nested = await Promise.all(imports.map((next) => sheets(root, next)));

  return [{ file, text }, ...nested.flat()];
}

beforeAll(async () => {
  unpacked = await publish();
  browser = await chromium.launch();
  [lightPage, darkPage] = await Promise.all([open(false), open(true)]);
});

afterAll(async () => {
  await browser.close();
  await rm(unpacked, { recursive: true, force: true });
});

test("ships plain CSS: every import resolves in the package, and no Tailwind", async () => {
  const found = await sheets(dirname(entry), relative(dirname(entry), entry));

  expect(found.map(({ file }) => file).toSorted()).toEqual([
    "glass.css",
    "index.css",
    "tokens.css",
  ]);
  expect(found.filter(({ text }) => TAILWIND.test(text)).map(({ file }) => file)).toEqual([]);
});

test("colour follows the theme: light by default, dark under .dark", async () => {
  expect(await token(lightPage, "--card")).toBe("oklch(0.993 0.001 270)");
  expect(await token(darkPage, "--card")).toBe("oklch(0.19 0.005 270)");
  expect(await token(lightPage, "--brand")).toBe("oklch(0.546 0.245 262.9)");
  expect(await token(darkPage, "--brand")).toBe("oklch(0.623 0.214 259.8)");
  expect(await token(lightPage, "--e-solar")).toBe("oklch(0.665 0.148 67)");
  expect(await token(darkPage, "--e-solar")).toBe("oklch(0.815 0.162 74)");
});

test("carries type, spacing, radius and icon tokens", async () => {
  expect(await token(lightPage, "--type-sans")).toBe('"Inter Variable", sans-serif');
  expect(await token(lightPage, "--type-mono")).toBe('"JetBrains Mono Variable", monospace');
  expect(await token(lightPage, "--space")).toBe("0.25rem");
  expect(await token(lightPage, "--touch-target")).toBe("2.75rem");
  expect(await token(lightPage, "--radius")).toBe("0.125rem");
  expect(await token(lightPage, "--icon-size")).toBe("1rem");
  expect(await token(lightPage, "--icon-stroke")).toBe("2");
});

test("ambient glass is thin and blurred: 64 % in light, 58 % in dark", async () => {
  expect(await surface(lightPage, ".glass-ambient")).toEqual({
    alpha: 0.64,
    blur: "blur(16px) saturate(1.4)",
  });
  expect((await surface(darkPage, ".glass-ambient")).alpha).toBe(0.58);
});

test("a canvas chip takes no blur", async () => {
  expect(await surface(darkPage, ".canvas-chip")).toEqual({ alpha: 0.9, blur: "none" });
});

test("reduced transparency turns every glass surface opaque", async () => {
  const pages = await Promise.all([open(false, true), open(true, true)]);

  const surfaces = await Promise.all(
    pages.flatMap((page) =>
      [".glass-ambient", ".glass", ".canvas-chip"].map((selector) => surface(page, selector)),
    ),
  );

  expect(surfaces).toEqual(Array.from({ length: 6 }, () => ({ alpha: 1, blur: "none" })));
});
