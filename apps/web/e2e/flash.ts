/// <reference types="bun" />
// fallow-ignore-file coverage-gaps -- needs a browser; run by hand with `bun run flash`.
// No flash on a route change (ADR 21): on the phone, a bar tap cross-fades the screens, and no
// frame in between may be brighter than both the screen it leaves and the one it lands on, in
// the dark theme and in the light. Records every composited frame through the CDP screencast with
// the page's animations slowed, so the verdict reads frames, not wall-clock time.

import { chromium, type Browser, type Page } from "playwright";
import { serve } from "./core.ts";
import { inTurn, land } from "./gestures.ts";
import { middayZone } from "./plant.ts";
import { plantNow } from "./series.ts";

const PORT = 18_210;

/** A mean luminance (0–1) this far above both ends is a flash a person sees. */
const FLASH = 0.02;

/** Animations play this many times slower, so the screencast catches the cross-fade's middle. */
const SLOWER = 10;

const ignore = (): void => {
  // Nothing to do: see the screencast's acks.
};

/** apps/web */
const web = new URL("..", import.meta.url).pathname;

const SCHEMES = ["dark", "light"] as const;

/** Bar taps, each from the screen before it. */
const TAPS = [
  ["history", "Prognose"],
  ["forecast", "Tarif"],
  ["tariff", "Dashboard"],
  ["", "Verlauf"],
] as const;

/** Mean relative luminance of each PNG frame, decoded by the browser itself. */
function luminances(decoder: Page, frames: readonly string[]): Promise<number[]> {
  return decoder.evaluate(
    (pngs) =>
      Promise.all(
        pngs.map(async (png) => {
          const bitmap = await createImageBitmap(
            await (await fetch(`data:image/png;base64,${png}`)).blob(),
          );

          const canvas = new OffscreenCanvas(39, 84);
          const context = canvas.getContext("2d", { willReadFrequently: true });

          if (context === null) throw new Error("no 2d context");

          context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);

          const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
          let sum = 0;

          for (let i = 0; i < data.length; i += 4)
            sum += (0.2126 * data[i]! + 0.7152 * data[i + 1]! + 0.0722 * data[i + 2]!) / 255;

          return sum / (data.length / 4);
        }),
      ),
    frames,
  );
}

/** The frames of one bar tap, from the screen at rest to the next screen at rest. */
async function framesOf(page: Page, name: string): Promise<string[]> {
  const cdp = await page.context().newCDPSession(page);
  const frames: string[] = [];

  // A frame left unacknowledged holds back the next; an ack after the screencast stops may fail.
  cdp.on("Page.screencastFrame", (frame: Readonly<{ data: string; sessionId: number }>) => {
    frames.push(frame.data);
    cdp.send("Page.screencastFrameAck", { sessionId: frame.sessionId }).catch(ignore);
  });

  await cdp.send("Animation.enable");
  await cdp.send("Animation.setPlaybackRate", { playbackRate: 1 / SLOWER });
  await cdp.send("Page.startScreencast", {
    format: "png",
    everyNthFrame: 1,
    maxWidth: 195,
    maxHeight: 422,
  });
  await land(page, 600);
  await page.getByRole("radio", { name: new RegExp(`^${name}`, "u") }).click();
  await land(page, 6000);
  await cdp.send("Page.stopScreencast");
  await cdp.send("Animation.setPlaybackRate", { playbackRate: 1 });
  await cdp.detach();

  return frames;
}

async function tapOnce(
  browser: Browser,
  decoder: Page,
  scheme: (typeof SCHEMES)[number],
  zone: string,
  [route, name]: (typeof TAPS)[number],
): Promise<boolean> {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
    locale: "de-DE",
    timezoneId: zone,
    colorScheme: scheme,
  });

  try {
    await context.addInitScript((mode) => {
      localStorage.setItem("mode-watcher-mode", mode);
      localStorage.setItem("sunreye.dashboard", "2d");
    }, scheme);

    const page = await context.newPage();

    await page.goto(`http://127.0.0.1:${PORT}/#/${route}`);
    await page.getByRole("main").first().waitFor();
    await land(page, 2500);

    const lums = await luminances(decoder, await framesOf(page, name));
    const ends = Math.max(lums[0] ?? 0, lums.at(-1) ?? 0);
    const peak = Math.max(...lums);
    const pass = lums.length > 2 && peak <= ends + FLASH;

    process.stdout.write(
      `${pass ? "pass" : "FAIL"}  ${scheme.padEnd(5)}  /${route.padEnd(8)} → ${name.padEnd(9)} ` +
        `frames ${String(lums.length).padStart(3)}  start ${lums[0]?.toFixed(3)}  ` +
        `peak ${peak.toFixed(3)}  end ${lums.at(-1)?.toFixed(3)}\n` +
        `      ${lums.map((l) => l.toFixed(2)).join(" ")}\n`,
    );

    return pass;
  } finally {
    await context.close();
  }
}

async function main(): Promise<number> {
  if (process.env["FLASH_NO_BUILD"] === undefined) {
    const build = Bun.spawn(["bun", "run", "build"], {
      cwd: web,
      stdout: "ignore",
      stderr: "pipe",
    });

    if ((await build.exited) !== 0) {
      process.stderr.write(await new Response(build.stderr).text());

      return 1;
    }
  }

  const zone = middayZone(Date.now());
  const core = serve(`${web}build`, PORT, plantNow(zone.name, zone.offset));
  const browser = await chromium.launch();
  const decoder = await browser.newPage();
  let failed = 0;

  try {
    await inTurn(SCHEMES, (scheme) =>
      inTurn(TAPS, async (tap) => {
        if (!(await tapOnce(browser, decoder, scheme, zone.name, tap))) failed += 1;
      }),
    );
  } finally {
    await browser.close();
    await core.stop();
  }

  process.stdout.write(failed === 0 ? "\n✓ no flash\n" : `\n✗ ${failed} taps flashed\n`);

  return failed === 0 ? 0 : 1;
}

process.exitCode = await main();
