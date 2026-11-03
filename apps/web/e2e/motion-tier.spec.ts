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
import { countTextMutations } from "./support/perf";

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
  await framesAt(page, 1000 / 60);
}

/**
 * Make the page a device that drops every other frame, BY CONSTRUCTION.
 *
 * The mirror of {@link withSteadyFrames}, 50 ms between frames. The watch is
 * bounded (three windows, then it stops), so it only downgrades a device that
 * is slow while it watches. CPU throttling applied after boot raced that
 * window: on a contended runner the throttle landed after the watch had judged
 * three healthy windows and given up, and nothing was left to downgrade it.
 */
async function withSlowFrames(page: import("@playwright/test").Page): Promise<void> {
  await framesAt(page, 50);
}

/** Every real frame advances the rAF timestamp by `stepMs`, and nothing else does. */
async function framesAt(page: import("@playwright/test").Page, stepMs: number): Promise<void> {
  await page.addInitScript((step) => {
    const real = window.requestAnimationFrame.bind(window);
    let lastReal: number | null = null;
    let faked = 0;
    window.requestAnimationFrame = (callback) =>
      real((ts) => {
        if (ts !== lastReal) {
          faked = lastReal === null ? ts : faked + step;
          lastReal = ts;
        }
        callback(faked);
      });
  }, stepMs);
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
  // slow from before the first frame and has to be caught by measurement alone.
  await withMotion(page, "auto");
  await withSlowFrames(page);
  await openPage(page, "/");
  // The watch settles for 4 s, then judges windows of 120 frames.
  await expect(dashes(page).first()).toBeAttached({ timeout: 60_000 });
  // The tier swap is not one commit: the dashes can be in before the last comet is out.
  await expect(comets(page)).toHaveCount(0);

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

/** Samples counted per tier. The count is per sample, never per second. */
const SAMPLES = 3;

/** Quiet that ends a sample: past the glide's last frame, short of the next sample. */
const QUIET_MS = 800;

/**
 * Watch for the readouts to go quiet, in the page's own clock.
 *
 * Armed BEFORE the sample is pushed, so the write it causes is seen. Resolves at
 * the first frame that comes {@link QUIET_MS} after the last text write, having
 * seen at least one: a glide ends when it ends, however many frames the host
 * managed meanwhile, and a snap is one write and then quiet.
 */
async function armQuiet(page: import("@playwright/test").Page): Promise<void> {
  await page.evaluate((quietMs) => {
    const w = window as unknown as { __readoutsQuiet?: Promise<void> };
    w.__readoutsQuiet = new Promise<void>((resolve) => {
      let last = 0;
      let seen = false;
      const observer = new MutationObserver(() => {
        seen = true;
        last = performance.now();
      });
      observer.observe(document.documentElement, { subtree: true, characterData: true });
      const frame = (now: number) => {
        if (seen && now - last >= quietMs) {
          observer.disconnect();
          resolve();
        } else requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
    });
  }, QUIET_MS);
}

async function untilQuiet(page: import("@playwright/test").Page): Promise<void> {
  await page.evaluate(
    () => (window as unknown as { __readoutsQuiet: Promise<void> }).__readoutsQuiet,
  );
}

/** Push one sample and wait until every readout has finished reacting to it. */
async function pushAndSettle(
  page: import("@playwright/test").Page,
  backend: import("./support/api-mock").MockBackend,
): Promise<void> {
  await armQuiet(page);
  await backend.pushMetrics();
  await untilQuiet(page);
}

/**
 * Text-node writes over {@link SAMPLES} samples at one tier.
 *
 * The samples are pushed by the spec and each is waited out, so the window is
 * a number of samples rather than a number of seconds: a host too busy to run
 * a clock on time still gets the same samples, and a glide still gets to finish.
 * No CPU throttle either: the counts are of writes, a throttle only takes
 * the frames the glide needs to be told apart from a snap.
 */
async function readoutWrites(
  browserPage: import("@playwright/test").Page,
  tier: string,
): Promise<number> {
  await withMotion(browserPage, tier);
  const { backend } = await openPage(browserPage, "/", { feedIntervalMs: 0 });
  // The boot's own writes (em dash to first value) are not the tier's business.
  await pushAndSettle(browserPage, backend);
  return countTextMutations(browserPage, async () => {
    for (let i = 0; i < SAMPLES; i++) await pushAndSettle(browserPage, backend);
  });
}

test("every tier below full stops the readout storm the glide runs", async ({ page }) => {
  // Three pages boot in turn, and a dev-server boot is tens of seconds on a busy host.
  test.setTimeout(360_000);
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

  // Ratios, deliberately loose: the glide's count moves with the frames the host
  // manages, a snap's does not (measured at load average 60: ~550-860 gliding
  // against 30 snapping, one write per readout per sample).
  expect(snapped).toBeLessThan(glided / 4);
  expect(frozen).toBeLessThan(glided / 4);
});
