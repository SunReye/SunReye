/**
 * What the motion tiers cost, and when `auto` gives up on a device. Measured, not asserted: the
 * frame-watch and the glide's text writes depend on how many frames the host manages, so a number
 * is only comparable run to run on an idle machine. `bun run bench:e2e` prints it; nothing fails.
 *
 * The tiers themselves (what each renders) are `e2e/motion-tier.spec.ts`.
 */

import { type Page, test } from "@playwright/test";
import type { MockBackend } from "../e2e/support/api-mock";
import { openPage } from "../e2e/support/open-page";
import { countTextMutations } from "../e2e/support/perf";
import { report } from "./report";

/** Pin the per-device setting before the app boots and reads it. */
async function withMotion(page: Page, value: string): Promise<void> {
  await page.addInitScript((v) => {
    try {
      localStorage.setItem("sunreye.motion", v as string);
    } catch {
      // A browser refusing storage falls back to `auto`.
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
async function withSteadyFrames(page: Page): Promise<void> {
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
async function withSlowFrames(page: Page): Promise<void> {
  await framesAt(page, 50);
}

/** Every real frame advances the rAF timestamp by `stepMs`, and nothing else does. */
async function framesAt(page: Page, stepMs: number): Promise<void> {
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

test("auto: how a device that cannot hold its frames is stepped down", async ({ page }) => {
  // A Fire HD 10 reports eight cores and no `deviceMemory`; only its dropped frames identify it.
  // Here the device is slow from before the first frame. The watch settles for 4 s, then judges
  // windows of 120 frames.
  await withMotion(page, "auto");
  await withSlowFrames(page);
  await openPage(page, "/");
  const downgraded = await page
    .locator("path.lite-flow")
    .first()
    .waitFor({ state: "attached", timeout: 60_000 })
    .then(
      () => true,
      () => false,
    );
  const stored = await page.evaluate(() => localStorage.getItem("sunreye.motion-strain"));
  report("motion-tier auto, slow frames", {
    steppedDown: downgraded,
    comets: await page.locator("animateMotion").count(),
    dashes: await page.locator("path.lite-flow").count(),
    strain: stored,
  });
});

test("auto: a device that holds its frames keeps the diagram", async ({ page }) => {
  await withMotion(page, "auto");
  await withSteadyFrames(page);
  await openPage(page, "/");
  // Past the settle delay and several windows: the watch is bounded and has given up by now.
  await page.waitForTimeout(15_000);
  const stored = await page.evaluate(() => localStorage.getItem("sunreye.motion-strain"));
  report("motion-tier auto, steady frames", {
    comets: await page.locator("animateMotion").count(),
    dashes: await page.locator("path.lite-flow").count(),
    strain: stored,
  });
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
async function armQuiet(page: Page): Promise<void> {
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

async function untilQuiet(page: Page): Promise<void> {
  await page.evaluate(
    () => (window as unknown as { __readoutsQuiet: Promise<void> }).__readoutsQuiet,
  );
}

/** Push one sample and wait until every readout has finished reacting to it. */
async function pushAndSettle(page: Page, backend: MockBackend): Promise<void> {
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
async function readoutWrites(browserPage: Page, tier: string): Promise<number> {
  await withMotion(browserPage, tier);
  const { backend } = await openPage(browserPage, "/", { feedIntervalMs: 0 });
  // The boot's own writes (em dash to first value) are not the tier's business.
  await pushAndSettle(browserPage, backend);
  return countTextMutations(browserPage, async () => {
    for (let i = 0; i < SAMPLES; i++) await pushAndSettle(browserPage, backend);
  });
}

test("readout text writes per tier: the glide against a snap", async ({ page }) => {
  // Three pages boot in turn, and a dev-server boot is tens of seconds on a busy host.
  test.setTimeout(360_000);
  // The glide writes a text node per readout per FRAME while it runs; snapping writes one per
  // readout per SAMPLE.
  const glided = await readoutWrites(page, "full");

  const lean = await page.context().newPage();
  const snapped = await readoutWrites(lean, "lite");
  await lean.close();

  const stillPage = await page.context().newPage();
  const frozen = await readoutWrites(stillPage, "still");
  await stillPage.close();

  report("motion-tier readout writes", {
    full: glided,
    lite: snapped,
    still: frozen,
    samples: SAMPLES,
  });
});
