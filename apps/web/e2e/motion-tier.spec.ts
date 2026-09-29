/**
 * What each motion tier actually renders, and what it stops costing.
 *
 * The bug: the dashboard on a wall tablet (Fire HD 10 and friends) lagged, then
 * stopped answering. Measured here at 6× CPU throttle, an IDLE overview spent
 * ~15 ms of every frame in style, layout, paint and compositing — ~10 ms of it
 * the power-flow hero (comet chains under a `blur()` + double `drop-shadow()`,
 * SMIL `<animateMotion>` writing attributes every frame) and the rest the
 * readouts' glide, which mutated ~365 text nodes a second.
 *
 * None of that is visible to the unit suite: the tier only exists in a running
 * document, and a source-text test over the branch would pass for a branch that
 * renders the wrong thing. So the tiers are proved by looking at what is in the
 * document, and the saving is proved by counting text mutations — a COUNT, not a
 * duration, so it means the same thing on a contended runner as on an idle one
 * (see `support/perf.ts`, "Read these numbers as ratios").
 */

import { expect, test } from "@playwright/test";
import { openPage } from "./support/open-page";
import { countTextMutations, throttleCpu } from "./support/perf";

/** Pin the per-device setting before the app boots and reads it. */
async function withMotion(page: import("@playwright/test").Page, value: string): Promise<void> {
  await page.addInitScript((v) => {
    try {
      localStorage.setItem("sunreye.motion", v as string);
    } catch {
      // A browser refusing storage falls back to `auto`, which this spec does
      // not then claim anything about.
    }
  }, value);
}

/**
 * Make the page a device that holds its frames, BY CONSTRUCTION.
 *
 * Every real frame hands its rAF callbacks a timestamp exactly one 60 Hz frame
 * after the previous one, however long the runner actually took to produce it;
 * callbacks in the same real frame share it, as in a browser. The frame watch
 * reads nothing else. Without this, "a machine that can afford the diagram" was
 * whatever machine ran the spec, and a CI shard contended by its neighbours is
 * not one: it dropped frames, the watch rightly stepped down, and the spec went
 * red on a heuristic doing its job.
 */
async function withSteadyFrames(page: import("@playwright/test").Page): Promise<void> {
  await page.addInitScript(() => {
    const real = window.requestAnimationFrame.bind(window);
    let lastReal: number | null = null;
    let steady = 0;
    window.requestAnimationFrame = (callback) =>
      real((ts) => {
        if (ts !== lastReal) {
          steady = lastReal === null ? ts : steady + 1000 / 60;
          lastReal = ts;
        }
        callback(steady);
      });
  });
}

const comets = (page: import("@playwright/test").Page) => page.locator("animateMotion");
const dashes = (page: import("@playwright/test").Page) => page.locator("path.lite-flow");

test("full renders the comet chains", async ({ page }) => {
  await withMotion(page, "full");
  await openPage(page, "/");
  await expect(comets(page).first()).toBeAttached();
  expect(await dashes(page).count()).toBe(0);
});

test("lite trades the comet chains for travelling dashes on the same cables", async ({ page }) => {
  // The middle tier has to keep the information: direction, speed and
  // magnitude. What it drops is the bead chain and its filter.
  await withMotion(page, "lite");
  await openPage(page, "/");
  await expect(dashes(page).first()).toBeAttached();
  expect(await comets(page).count()).toBe(0);
  const dash = dashes(page).first();
  // Speed still comes from the rail's own quantized crossing time…
  expect(await dash.evaluate((el) => getComputedStyle(el).animationDuration)).not.toBe("0s");
  // …and nothing here is filtered, which is what the tier exists to avoid.
  const filtered = await page.evaluate(
    () =>
      [...document.querySelectorAll("svg *")].filter((el) => {
        const f = getComputedStyle(el).filter;
        return f !== "none" && f !== "";
      }).length,
  );
  expect(filtered).toBe(0);
});

test("still renders no animation at all, and still states the magnitude", async ({ page }) => {
  await withMotion(page, "still");
  await openPage(page, "/");
  // The rails are there — a still diagram, not an empty one.
  await expect(page.locator("svg path").first()).toBeAttached();
  expect(await comets(page).count()).toBe(0);
  expect(await dashes(page).count()).toBe(0);
  // Scoped to the hero: the app shell's own chrome (a sidebar, a toast) is not
  // this tier's business, and a blanket count would drift with it.
  const running = await page.evaluate(() => {
    const hero = document.querySelector("section:has(svg)") ?? document.body;
    return document.getAnimations().filter((a) => {
      if (a.playState !== "running") return false;
      const target = (a.effect as KeyframeEffect | null)?.target as Element | null;
      return target !== null && hero.contains(target);
    }).length;
  });
  expect(running).toBe(0);
});

test("the degraded tiers stop the hero's per-sample transitions too", async ({ page }) => {
  // Not just the comets: every node box carries a 500 ms box-shadow/background
  // transition and every gauged node a 500 ms `stroke-dashoffset` one, and the
  // plant wandering across a `pulseShare` bucket keeps a wave of them running.
  // Measured on the idle overview before this fix: 43 at once, at the tier that
  // was supposed to be holding still.
  await withMotion(page, "lite");
  await openPage(page, "/");
  await page.waitForTimeout(3000);
  const transitions = await page.evaluate(
    () =>
      document
        .getAnimations()
        .filter((a) => a.constructor.name === "CSSTransition" && a.playState === "running").length,
  );
  expect(transitions).toBe(0);
});

test("auto steps a device that cannot hold its frames down a tier, and remembers", async ({
  page,
}) => {
  // The mechanism the whole fix rests on, and the one no static signal could
  // deliver: a Fire HD 10 reports eight cores and no `deviceMemory`, so the only
  // thing that identifies it is that it drops frames. Here the device is made
  // slow with CPU throttling and has to be caught by measurement alone.
  await withMotion(page, "auto");
  await openPage(page, "/");
  await expect(comets(page).first()).toBeAttached();

  const restore = await throttleCpu(page, 20);
  // The watch settles for 4 s, then judges windows of 120 frames. On a device
  // this slow that is a few seconds per window; the wait is generous because
  // the assertion is the downgrade, not how fast it arrives.
  await expect(dashes(page).first()).toBeAttached({ timeout: 60_000 });
  expect(await comets(page).count()).toBe(0);
  await restore();

  // …and it is remembered, so the next visit starts lean instead of stuttering
  // through another window first.
  const stored = await page.evaluate(() => localStorage.getItem("sunreye.motion-strain"));
  expect(Number(stored)).toBeGreaterThan(0);
});

test("auto leaves a device that IS holding its frames alone", async ({ page }) => {
  // The other half of the claim, and the one a downgrade-happy heuristic would
  // fail: a machine that can afford the diagram keeps it. An unasked-for
  // downgrade is as much a bug as the stutter it was meant to remove.
  await withMotion(page, "auto");
  await withSteadyFrames(page);
  await openPage(page, "/");
  // Past the settle delay and several windows — the watch has judged and given
  // up by now (it is bounded, so a quiet kiosk is not held at 60 Hz forever).
  await page.waitForTimeout(15_000);
  await expect(comets(page).first()).toBeAttached();
  expect(await dashes(page).count()).toBe(0);
  const stored = await page.evaluate(() => localStorage.getItem("sunreye.motion-strain"));
  expect(stored === null || stored === "0").toBe(true);
});

/** Text-node writes over six seconds of the fixture's 1 Hz feed, at one tier. */
async function readoutWrites(
  browserPage: import("@playwright/test").Page,
  tier: string,
): Promise<number> {
  await withMotion(browserPage, tier);
  await openPage(browserPage, "/");
  const restore = await throttleCpu(browserPage, 6);
  const writes = await countTextMutations(browserPage, () => browserPage.waitForTimeout(6000));
  await restore();
  return writes;
}

test("every tier below full stops the readout storm the glide runs", async ({ page }) => {
  // The glide writes a text node per readout per FRAME while it runs; snapping
  // writes one per readout per SAMPLE. At the fixture's 1 Hz feed that is the
  // difference between a per-frame storm and a handful of writes — and it is the
  // half of the frame cost that is not the hero, so `lite` has to take it too.
  // `lite` keeps the motion that is INFORMATION (the rails' direction and
  // speed); the readout drift is an affordance, and the number is the same
  // either way.
  const glided = await readoutWrites(page, "full");

  const lean = await page.context().newPage();
  const snapped = await readoutWrites(lean, "lite");
  await lean.close();

  const stillPage = await page.context().newPage();
  const frozen = await readoutWrites(stillPage, "still");
  await stillPage.close();

  // Ratios, deliberately loose: the absolute counts move with the machine, the
  // order of magnitude does not (measured here: ~3300 against ~100 per 10 s).
  expect(snapped).toBeLessThan(glided / 4);
  expect(frozen).toBeLessThan(glided / 4);
});
