/// <reference types="bun" />
// fallow-ignore-file coverage-gaps -- needs a browser; run by hand with `bun run smoothness`.
// The smoothness journeys (ADR 21), outside the gate (ADR 11): builds the SPA, serves it from a
// fake core, and runs each journey at 1× and 4× CPU throttle in Chromium, one page at a time.
// The 4× run is judged; the 1× run tells software rendering (which does not scale with the
// throttle) from main-thread work (which does). `bun run smoothness <words>` runs the journeys
// whose names contain them.

import { chromium, type Browser, type BrowserContext } from "playwright";
import { verdict } from "./budget.ts";
import { serve } from "./core.ts";
import { inTurn } from "./gestures.ts";
import { JOURNEYS, type Journey } from "./journeys.ts";
import { middayZone } from "./plant.ts";
import { PROBE, type Recording } from "./probe.ts";
import { plantNow } from "./series.ts";

const PORT = 18_200;
const RATES = [1, 4] as const;

/** Pointer presses must reach their handler this soon (ADR 21). */
const INPUT_DELAY_MS = 50;

/** apps/web */
const web = new URL("..", import.meta.url).pathname;

function open(browser: Browser, journey: Journey, zone: string): Promise<BrowserContext> {
  const phone = journey.phone === true;

  return browser.newContext({
    viewport: phone ? { width: 390, height: 844 } : { width: 1280, height: 800 },
    hasTouch: phone,
    isMobile: phone,
    locale: "de-DE",
    timezoneId: zone,
  });
}

async function record(
  browser: Browser,
  journey: Journey,
  rate: number,
  zone: string,
): Promise<Recording> {
  const context = await open(browser, journey, zone);

  try {
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    const throttle = () => cdp.send("Emulation.setCPUThrottlingRate", { rate });

    await page.addInitScript({ content: PROBE });
    await page.addInitScript((storage) => {
      for (const [key, value] of Object.entries(storage)) localStorage.setItem(key, value);
    }, journey.storage ?? {});

    if (journey.cold === true) await throttle();

    await page.goto(`http://127.0.0.1:${PORT}/#/${journey.route}`);

    if (journey.cold !== true) {
      await page.getByRole("main").first().waitFor();

      // Away from the rail, which a resting mouse in the corner would hold open.
      if (journey.phone !== true) await page.mouse.move(800, 400);

      await journey.ready?.(page);
      await page.waitForTimeout(1500);
      await throttle();
    }

    await page.evaluate(() => {
      window.smoothness.start();
    });
    await journey.act(page, cdp);

    return await page.evaluate(() => window.smoothness.stop());
  } finally {
    await context.close();
  }
}

const ms = (n: number) => (Number.isFinite(n) ? n.toFixed(1).padStart(6) : "     –");

/** One line per run, its three longest frames below; returns whether it kept the budget. */
function report(journey: Journey, rate: number, rec: Recording): boolean {
  const judged = verdict(rec.frames);
  const delay = Math.max(...rec.delays, Number.NEGATIVE_INFINITY);
  const blocked = Math.max(...rec.loaf.map(({ blocking }) => blocking), 0);

  const pass =
    journey.input === true ? rec.delays.length > 0 && delay <= INPUT_DELAY_MS : judged.pass;

  const frames = `frames ${String(judged.frames).padStart(4)}  p95 ${ms(judged.p95)}  max ${ms(judged.max)}`;
  const loaf = `LoAF ${String(rec.loaf.length).padStart(3)} (blocking max ${ms(blocked)})`;
  const input = `input max ${ms(delay)} of ${rec.delays.length}`;

  process.stdout.write(
    `${rate}× ${pass ? "pass" : "FAIL"}  ${frames}  ${loaf}  ${input}  tier ${rec.tier}\n`,
  );

  for (const frame of rec.loaf.toSorted((a, b) => b.duration - a.duration).slice(0, 3))
    process.stdout.write(
      `      LoAF ${frame.duration} ms, blocking ${frame.blocking} ms: ${frame.script}\n`,
    );

  return pass;
}

async function main(words: readonly string[]): Promise<number> {
  const build = Bun.spawn(["bun", "run", "build"], { cwd: web, stdout: "ignore", stderr: "pipe" });

  if ((await build.exited) !== 0) {
    process.stderr.write(await new Response(build.stderr).text());

    return 1;
  }

  const journeys = JOURNEYS.filter(({ name }) => words.every((word) => name.includes(word)));
  const zone = middayZone(Date.now());
  const core = serve(`${web}build`, PORT, plantNow(zone.name, zone.offset));
  const browser = await chromium.launch();
  const over: string[] = [];

  try {
    // One page at a time: every page's WebGL shares one software renderer here.
    await inTurn(journeys, async (journey) => {
      process.stdout.write(`\n${journey.name}\n`);
      await inTurn(RATES, async (rate) => {
        const kept = report(journey, rate, await record(browser, journey, rate, zone.name));

        if (rate === 4 && !kept) over.push(journey.name);
      });
    });
  } finally {
    await browser.close();
    await core.stop();
  }

  process.stdout.write(
    over.length === 0
      ? "\n✓ every journey kept its budget at 4×\n"
      : `\n✗ over budget at 4×: ${over.join("; ")}\n`,
  );

  return over.length === 0 ? 0 : 1;
}

process.exitCode = await main(process.argv.slice(2));
