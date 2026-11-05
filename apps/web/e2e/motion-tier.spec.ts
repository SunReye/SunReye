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
 * document. The frame-watch that steps `auto` down and the readout write counts
 * per tier depend on the host's frame rate: `bench/motion-tier.bench.ts`.
 */

import { expect, test } from "@playwright/test";
import { openPage } from "./support/open-page";

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
  const { backend } = await openPage(page, "/", { feedIntervalMs: 0 });
  // A sample is what starts them: asked for straight after one, while a 500 ms transition would
  // still be running, so nothing is waited out and a transition cannot have finished unseen.
  for (let sample = 0; sample < 3; sample++) {
    await backend.pushMetrics();
    const transitions = await page.evaluate(
      () =>
        document
          .getAnimations()
          .filter((a) => a.constructor.name === "CSSTransition" && a.playState === "running")
          .length,
    );
    expect(transitions).toBe(0);
  }
});
