import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import "../../app.css";
import { connect } from "../api/core.ts";
import { finish, hold } from "../motion/animations.harness.ts";
import { FakeCore } from "./devices.harness.ts";
import Routed from "./routed.harness.svelte";

beforeEach(async () => {
  hold();
  await page.viewport(390, 800);
});

afterEach(() => {
  vi.restoreAllMocks();
  // The levels move the hash.
  history.replaceState(null, "", location.pathname + location.search);
});

/** The travels under way on `node`. */
const travels = (node: Element) =>
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- the DOM's own type.
  node.getAnimations().filter((each) => Number(each.effect?.getTiming().duration) > 0);

/** How far right of its place `node` is drawn, in its own widths. */
const right = (node: Element) =>
  new DOMMatrix(getComputedStyle(node).transform).m41 / node.getBoundingClientRect().width;

test.for([
  ["the level's back button", () => page.getByRole("button", { name: "Geräte" }).click()],
  [
    "browser back",
    async () => {
      history.back();
      await Promise.resolve();
    },
  ],
] as const)(
  "%s slides a device's level out to the right over the list it came from",
  async ([, back]) => {
    const screen = await render(Routed, { core: connect(new FakeCore()), group: "devices" });

    await screen.getByRole("button", { name: /^Wechselrichter/u }).click();

    const level = screen.getByRole("region", { name: "Wechselrichter" });

    await expect.element(level).toBeVisible();

    const node = level.element();

    // The slide in has landed: back starts from rest.
    await finish(() => travels(node).length === 0);
    await back();

    // The list is back under the level, which is on its way out.
    await expect.element(screen.getByRole("button", { name: "Gerät hinzufügen" })).toBeVisible();
    await expect.poll(() => travels(node).length).toBe(1);

    const slide = travels(node)[0]!;

    expect(node.isConnected).toBe(true);
    expect(slide.effect?.getTiming().duration).toBe(300);

    slide.pause();
    slide.currentTime = 75;

    // ADR 21's ease-in-out is 0.0708 of the way after a quarter of the time.
    expect(right(node)).toBeCloseTo(0.0708, 2);

    slide.finish();

    await expect.element(level).not.toBeInTheDocument();
  },
);
