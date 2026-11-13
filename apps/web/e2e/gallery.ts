/// <reference types="bun" />
// fallow-ignore-file coverage-gaps -- needs a browser; run by hand with `bun run gallery`.
// Screenshots of the kit's gallery (#750) in light and dark: `bun run gallery [directory]`.
// The gallery exists under `vite dev` only, so this serves the sources, with no core behind them.

import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Browser } from "playwright";

const PORT = 18_220;

/** apps/web */
const web = new URL("..", import.meta.url).pathname;

const SCHEMES = ["light", "dark"] as const;

const VIEWS = [
  { name: "desktop", width: 1280, height: 900, touch: false },
  { name: "phone", width: 390, height: 844, touch: true },
] as const;

async function served(): Promise<void> {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      // oxlint-disable-next-line no-await-in-loop -- polls until the dev server answers.
      if ((await fetch(`http://127.0.0.1:${PORT}/`)).ok) return;
    } catch {
      // Not up yet.
    }

    // oxlint-disable-next-line no-await-in-loop -- polls until the dev server answers.
    await Bun.sleep(250);
  }

  throw new Error("vite dev did not start");
}

async function shoot(
  browser: Browser,
  directory: string,
  scheme: (typeof SCHEMES)[number],
  view: (typeof VIEWS)[number],
): Promise<string> {
  const context = await browser.newContext({
    viewport: { width: view.width, height: view.height },
    hasTouch: view.touch,
    isMobile: view.touch,
    colorScheme: scheme,
    reducedMotion: "reduce",
  });

  await context.addInitScript((mode) => {
    localStorage.setItem("mode-watcher-mode", mode);
  }, scheme);

  // No core: every API read is refused at once, and the gallery needs none.
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Playwright's route is mutable.
  await context.route("**/api/v1/**", (route) => route.fulfill({ status: 503, body: "" }));

  const page = await context.newPage();

  await page.goto(`http://127.0.0.1:${PORT}/#/gallery`);
  await page.locator("[data-gallery=resizable]").waitFor();
  await page.evaluate(() => document.fonts.ready);

  const path = join(directory, `gallery-${view.name}-${scheme}.png`);

  // As tall as the gallery, so the shell's fixed rail or bar is drawn once, not over every screenful.
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- a DOM element is mutable.
  const height = await page.locator("[data-gallery-root]").evaluate((root) => root.scrollHeight);

  await page.setViewportSize({ width: view.width, height: Math.ceil(height) });
  // Off the rail, which opens under a resting pointer.
  await page.mouse.move(view.width - 8, 8);
  await page.waitForTimeout(600);
  await page.screenshot({ path });
  await context.close();

  return path;
}

const directory = process.argv[2] ?? join(tmpdir(), "sunreye-gallery");

await mkdir(directory, { recursive: true });

const vite = Bun.spawn(
  ["bunx", "vite", "dev", "--port", String(PORT), "--host", "127.0.0.1", "--strictPort"],
  { cwd: web, stdio: ["ignore", "ignore", "inherit"] },
);

try {
  await served();

  const browser = await chromium.launch();

  try {
    for (const view of VIEWS) {
      for (const scheme of SCHEMES) {
        // oxlint-disable-next-line no-await-in-loop -- one page at a time keeps the shots stable.
        process.stdout.write(`${await shoot(browser, directory, scheme, view)}\n`);
      }
    }
  } finally {
    await browser.close();
  }
} finally {
  vite.kill();
}
