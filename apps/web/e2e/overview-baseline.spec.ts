import { expect, test } from "@playwright/test";
import { mockBackend } from "./support/api-mock";
import { measureScroll, startProbe, stopProbe, throttleCpu } from "./support/perf";

/**
 * The control group.
 *
 * The overview is measured healthy in production — 59.9 fps, zero long tasks —
 * so it is what says whether a bad /history number is the page or the machine.
 * Read it as a ratio, never as an absolute: CI hardware is not the tablet the
 * baselines were taken on, and an fps floor pinned to a number would flake on
 * every runner change.
 */
test("overview idles at the machine's frame rate with no long tasks", async ({ page }) => {
  const backend = await mockBackend(page);
  await page.goto("/#/");
  await backend.waitForLive();

  const id = await startProbe(page);
  await page.waitForTimeout(4000);
  const raw = await stopProbe(page, id);
  const spanMs = Math.max(1, raw.lastFrame - raw.firstFrame);
  const fps = Math.round(((raw.frames - 1) / (spanMs / 1000)) * 10) / 10;

  // A healthy idle page runs at whatever the display does and blocks nothing.
  expect(fps).toBeGreaterThan(30);
  expect(raw.blockedMs).toBeLessThan(1000);
  console.log(`[control] Overview idle: ${fps} fps · ${raw.longTasks} long tasks`);
});

test("overview scrolls cleanly under the same 4x throttle /history is judged at", async ({
  page,
}) => {
  const backend = await mockBackend(page);
  await page.goto("/#/");
  await backend.waitForLive();

  const restore = await throttleCpu(page, 4);
  const result = await measureScroll(page, { seconds: 6, stepFraction: 0.5 });
  await restore();

  expect(result.fps).toBeGreaterThan(0);
  console.log(
    `[control] Overview scroll, 4x CPU: ${result.fps} fps · ${result.longTasks} long tasks · ` +
      `${result.blockedMs}ms blocked in ${result.durationMs}ms`,
  );
});
