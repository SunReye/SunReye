/// <reference types="bun" />
// fallow-ignore-file coverage-gaps -- needs a browser; run by hand with `bun run gallery`.
// Screenshots of the kit's gallery (#750) in light and dark: `bun run gallery [directory]`.
// The gallery exists under `vite dev` only, so this serves the sources, with no core behind them.

import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Browser, type Page } from "playwright";

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

type Scheme = (typeof SCHEMES)[number];

type View = (typeof VIEWS)[number];

/** The gallery in a context of its own, loaded. The fade shots keep motion: the still tier drops the fade. */
async function gallery(
  browser: Browser,
  scheme: Scheme,
  view: View,
  reducedMotion: "reduce" | "no-preference",
): Promise<Page> {
  const context = await browser.newContext({
    viewport: { width: view.width, height: view.height },
    hasTouch: view.touch,
    isMobile: view.touch,
    colorScheme: scheme,
    reducedMotion,
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
  // Off the rail, which opens under a resting pointer and would cover the page.
  await page.mouse.move(view.width - 8, 8);
  await page.waitForTimeout(600);

  return page;
}

/** The scroll fade (#753) mid-scroll: a list, a chip row and a long drawer. */
async function fades(
  browser: Browser,
  directory: string,
  scheme: Scheme,
  view: View,
): Promise<string[]> {
  const page = await gallery(browser, scheme, view, "no-preference");
  const suffix = `${view.name}-${scheme}`;
  const demo = page.locator("[data-gallery=scroll-fade]");

  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- a DOM element is mutable.
  await demo.evaluate((element) => {
    for (const scroller of element.querySelectorAll("[class*=scroll-fade]")) {
      scroller.scrollTo({ top: 80, left: 60 });
    }
  });

  const rows = join(directory, `scroll-fade-rows-${suffix}.png`);

  await demo.screenshot({ path: rows });
  await page.getByRole("button", { name: "Open drawer" }).click();

  const list = page.getByRole("dialog").locator("[class*=scroll-fade]");

  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- a DOM element is mutable.
  await list.evaluate((element) => {
    element.scrollTo({ top: 120 });
  });
  await page.waitForTimeout(600);

  const drawer = join(directory, `scroll-fade-drawer-${suffix}.png`);

  await page.getByRole("dialog").screenshot({ path: drawer });
  await page.context().close();

  return [rows, drawer];
}

async function shoot(
  browser: Browser,
  directory: string,
  scheme: Scheme,
  view: View,
): Promise<string[]> {
  const page = await gallery(browser, scheme, view, "reduce");
  const path = join(directory, `gallery-${view.name}-${scheme}.png`);

  // As tall as the gallery, so the shell's fixed rail or bar is drawn once, not over every screenful.
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- a DOM element is mutable.
  const height = await page.locator("[data-gallery-root]").evaluate((root) => root.scrollHeight);

  await page.setViewportSize({ width: view.width, height: Math.ceil(height) });
  await page.screenshot({ path });

  await page.context().close();

  return [path, ...(await fades(browser, directory, scheme, view))];
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
        process.stdout.write(`${(await shoot(browser, directory, scheme, view)).join("\n")}\n`);
      }
    }
  } finally {
    await browser.close();
  }
} finally {
  vite.kill();
}
