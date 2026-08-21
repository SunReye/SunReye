/**
 * What a finger does to a chart, and what it must not do.
 *
 * The decision, made with the user: on a coarse pointer a chart rests LOCKED. A
 * drag scrolls the PAGE, a hold scrubs the tooltip crosshair, and pinch/pan are
 * ignored until the viewer taps the control. Pinch-by-default would trap the
 * finger on /history, which is a stack of ~100 full-width charts and where
 * scrolling is the primary gesture; pinch stays one tap away.
 *
 * A BROWSER claim throughout. The mode mapping is pure and unit-tested
 * (`src/lib/charts/gesture.test.ts`); what cannot be asserted there is what a
 * real finger on a real laid-out document does. `touch-action` is resolved by
 * the compositor from four stacked elements — the app's container override, the
 * brush layer's own stylesheet, LayerChart's inline transform rule and the
 * tooltip layer's `--touch-action` — and no unit test can see that stack.
 *
 * ## Which case is the headline, and why it is not the page scroll
 *
 * The obvious statement of the feature — "a swipe scrolls the page instead of
 * being eaten" — turned out NOT to be what changed. Reverting the decision to
 * `restingMode(false)` (brush on touch, the behaviour before this pass) leaves
 * the vertical swipe scrolling exactly as it does now, because
 * `chart-container.svelte` has carried `[&_.lc-brush-context]:touch-pan-y`
 * since the brush landed: the brush layer declares `touch-action: none` on
 * itself and that override already hands the vertical axis back. Page scroll is
 * a FLOOR that both resting modes clear, so a case asserting it cannot tell
 * them apart, and one named as though it could is decoration. Watched: with
 * `restingMode(false)` applied, the swipe case passes.
 *
 * What the decision really changed is what a DRAG ALONG THE AXIS does. In brush
 * it draws a selection and the page answers by refetching every card at a finer
 * rollup — the mis-swipe that motivated the whole change (measured: 3 rollup
 * calls turning into 6). In locked it does nothing at all. That is the headline
 * below, and it is the case that goes red on the revert.
 *
 * The default context here has `hasTouch: true`, which Chromium reports as
 * `(pointer: coarse)`; that is what makes the resting mode locked without the
 * spec touching a setting.
 */

import { expect, test, type Locator, type Page } from "@playwright/test";
import { openHistory, periodNavigator, rollupCalls } from "./support/history";
import { type MockBackend } from "./support/api-mock";
import { SELECTORS } from "./support/perf";

const PHONE = { width: 390, height: 844 };

/** One CDP touch point. `id` is the finger; two ids is a pinch. */
interface Finger {
  x: number;
  y: number;
  id: number;
}

/**
 * A real multi-touch driver.
 *
 * `page.touchscreen` only taps, so neither a held scrub nor a two-finger pinch
 * is reachable through it. `Input.dispatchTouchEvent` is: it injects at the
 * browser's own input pipeline, so the events go through hit-testing and
 * `touch-action` exactly as a finger's would — which is the property this whole
 * spec is measuring and the reason a hand-dispatched `new TouchEvent()` would
 * be worthless here (it bypasses both).
 */
async function fingers(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  type TouchEventType = "touchStart" | "touchEnd" | "touchMove" | "touchCancel";
  const send = (type: TouchEventType, touchPoints: Finger[]) =>
    cdp.send("Input.dispatchTouchEvent", { type, touchPoints });
  return {
    down: (...points: Finger[]) => send("touchStart", points),
    move: (...points: Finger[]) => send("touchMove", points),
    up: () => send("touchEnd", []),
    /** A swipe as a series of moves — one jump is not a gesture to a compositor. */
    async drag(from: Finger, to: Finger, steps = 12) {
      await this.down(from);
      for (let i = 1; i <= steps; i++) {
        const t = i / steps;
        await this.move({
          id: from.id,
          x: from.x + (to.x - from.x) * t,
          y: from.y + (to.y - from.y) * t,
        });
      }
      await this.up();
    },
  };
}

/**
 * The page's scroll offset.
 *
 * `window`, not the shell's `<main>`: measured on /history at 390px, the
 * scroller's `scrollHeight` and `clientHeight` are both 16874 — the shell grows
 * to its content and the DOCUMENT is what scrolls. Reading `main.scrollTop`
 * here would return a constant 0 and the assertion would be unfalsifiable.
 */
function scrollOffset(page: Page): Promise<number> {
  return page.evaluate(() => window.scrollY);
}

/**
 * /history on a HISTORICAL window, at phone width, with the first zoomable
 * chart on screen.
 *
 * The step back matters: the range the page opens on is `live`, and
 * `metric-card-plot.svelte` answers that with the gliding `LiveArea`, which
 * takes no gesture controller at all (it owns a transform of its own inside a
 * ClipPath). A spec that skipped this would be measuring a chart that has no
 * lock, no brush and no transform context, and every case in it would pass by
 * finding nothing.
 */
async function openLockedChart(page: Page): Promise<{
  backend: MockBackend;
  /** The metric card, so a control can be scoped to THIS chart's overlay. */
  card: Locator;
  chart: Locator;
  /** The lock/pinch toggle: the only `aria-pressed` control on this card. */
  lock: Locator;
  box: { x: number; y: number; width: number; height: number };
}> {
  const backend = await openHistory(page);
  await periodNavigator(page).back.click();
  const card = page.locator(SELECTORS.metricCard).first();
  const chart = card.locator(SELECTORS.chart).first();
  await expect(chart).toBeVisible();
  // The transform wrapper is the last thing LayerChart adds; waiting for it is
  // waiting for the historical chart to have replaced the live one.
  await expect(chart.locator(".lc-transform-context")).toBeAttached();
  await chart.scrollIntoViewIfNeeded();
  return {
    backend,
    card,
    chart,
    lock: card.locator("[aria-pressed]").first(),
    box: (await chart.boundingBox())!,
  };
}

/** `touch-action` as the cascade resolved it, for one element inside a chart. */
function touchAction(chart: Locator, selector: string): Promise<string> {
  return chart
    .locator(selector)
    .first()
    .evaluate((el) => getComputedStyle(el).touchAction);
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize(PHONE);
});

test("a chart on a phone rests locked: no brush layer at all", async ({ page }) => {
  const { chart } = await openLockedChart(page);
  // The brush layer is the thing that eats the gesture: `BrushContext` renders
  // nothing while disabled, and its own `@layer base` stylesheet is where
  // `touch-action: none` comes from. Counting the element is the DOM-level
  // statement of "locked" and needs no gesture to be wrong.
  expect(await chart.locator(".lc-brush-context").count()).toBe(0);
});

test("THE assertion: locked, a horizontal drag selects nothing and refetches nothing", async ({
  page,
}) => {
  // The one case that discriminates locked from brush (see the header). Under
  // `restingMode(false)` the same drag draws a range and the page refetches
  // every card at a finer rollup: measured 3 calls turning into 6, which is
  // exactly the mis-swipe this pass exists to stop.
  const { backend, chart, box } = await openLockedChart(page);
  const before = rollupCalls(backend).length;

  const hand = await fingers(page);
  const y = box.y + box.height / 2;
  await hand.drag(
    { id: 1, x: box.x + box.width * 0.25, y },
    { id: 1, x: box.x + box.width * 0.75, y },
  );

  // No selection was drawn, and — the part that matters — the page did not
  // answer one by refetching every card at a finer rollup. That is what a
  // brush-by-default does to a mis-swipe on a phone.
  expect(await chart.locator(".lc-brush-range").count()).toBe(0);
  await page.waitForTimeout(500);
  expect(rollupCalls(backend).length).toBe(before);
});

test("a vertical swipe on a chart scrolls the page — the floor, in every mode", async ({
  page,
}) => {
  // Named for what it proves. This is the property the feature is ABOUT, but it
  // does not discriminate locked from brush: `[&_.lc-brush-context]:touch-pan-y`
  // in chart-container.svelte hands the vertical axis back in brush too, so the
  // case stays green on the revert (watched). It is kept because the floor is
  // real and cheap to lose — an inline `touch-action: none` from the transform,
  // a `preventDefault()` on touchmove, or dropping that override would each trap
  // the finger on a page that is ~100 charts tall — and because a swipe that
  // scrolls is what makes the locked mode usable at all.
  const { box } = await openLockedChart(page);
  const before = await scrollOffset(page);

  const hand = await fingers(page);
  const mid = { id: 1, x: box.x + box.width / 2, y: box.y + box.height * 0.8 };
  await hand.drag(mid, { ...mid, y: box.y - box.height });
  // The compositor scrolls on its own clock, and the fling carries on after the
  // finger lifts, so this is polled rather than read once.
  await expect
    .poll(() => scrollOffset(page), { message: "the page never moved under the finger" })
    .toBeGreaterThan(before);
});

test("and the transform never claims the touch while locked", async ({ page }) => {
  const { chart } = await openLockedChart(page);
  // LayerChart writes `style:touch-action: none` on `.lc-transform-context`
  // whenever its pointer transform is live, and `preventDefault()`s every
  // touchmove under the same condition. Either one alone stops the page
  // scrolling, so the resting mode has to leave both off.
  expect(await touchAction(chart, ".lc-transform-context")).not.toBe("none");
  // What is left is the tooltip layer's own `pan-y`: the browser keeps the
  // vertical axis (page scroll) and the chart keeps the horizontal one (the
  // hold-and-scrub that moves the crosshair).
  expect(await touchAction(chart, ".lc-tooltip-context")).toBe("pan-y");
});

test("one tap arms pinch, and then the plot does claim the touch", async ({ page }) => {
  const { chart, lock } = await openLockedChart(page);
  await lock.click();

  // Armed: the transform's own inline rule is what captures a two-finger
  // gesture, and it is also why this is opt-in — page scrolling on THIS chart
  // stops for as long as it is on, so the way back out has to stay visible.
  expect(await touchAction(chart, ".lc-transform-context")).toBe("none");
  await expect(lock).toHaveAttribute("aria-pressed", "true");
  // And the brush stays off: LayerChart wires the brush and the pointer
  // transform to the same pointer, so arming one must disable the other.
  expect(await chart.locator(".lc-brush-context").count()).toBe(0);
});

test("armed, a real two-finger pinch zooms the chart", async ({ page }) => {
  const { card, lock, box } = await openLockedChart(page);
  await lock.click();

  const y = box.y + box.height / 2;
  const centre = box.x + box.width / 2;
  const hand = await fingers(page);
  await hand.down({ id: 1, x: centre - 30, y }, { id: 2, x: centre + 30, y });
  for (let i = 1; i <= 10; i++) {
    const spread = 30 + i * 10;
    await hand.move({ id: 1, x: centre - spread, y }, { id: 2, x: centre + spread, y });
  }
  await hand.up();

  // The reset control appears the moment anything is zoomed, and nothing else
  // on this chart can make it appear — the page's own range never moved.
  // Scoped to THIS card: every other card carries the same control, so an
  // unscoped locator would pass on a chart nobody pinched.
  await expect(card.getByRole("button", { name: "Reset zoom" })).toBeVisible();
});
