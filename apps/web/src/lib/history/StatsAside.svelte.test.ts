/* oxlint-disable typescript/prefer-readonly-parameter-types -- the DOM, used in place. */
// What stands out appears and leaves with the range's data: payback below it glides (ADR 21).
// The test page is narrower than the aside's two columns begin.
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { render } from "vitest-browser-svelte";
import "../../app.css";
import type { Payback } from "../api/tariff.ts";
import { finish, hold } from "../motion/animations.harness.ts";
import { playFrame, settle } from "../motion/clock.harness.ts";
import StatsAside from "./StatsAside.svelte";
import type { Summary } from "./summary.ts";

beforeEach(hold);

afterEach(() => {
  vi.restoreAllMocks();
});

const SUMMARY: Summary = {
  sentence: "",
  gapHours: 10,
  breakdown: [],
  against: "",
  peaks: [],
  notes: [{ tone: "warn", text: "10 h ohne Daten ab 02:00", action: "Tag öffnen" }],
};

const PAYBACK: Payback = { investment: 12_000, remaining: 9000, savings: 3000, months: [] };

const moves = () =>
  document.getAnimations().filter((a) => Number(a.effect?.getComputedTiming().duration) > 0);

function at(share: number): void {
  for (const move of moves())
    move.currentTime = Number(move.effect?.getComputedTiming().duration) * share;
}

const props = (loading: boolean) => ({
  label: "Heute",
  summary: SUMMARY,
  loading,
  fresh: false,
  since: 0,
  today: 0,
  payback: PAYBACK,
  tucked: false,
  onnote: vi.fn(),
  onrange: vi.fn(),
  onpayback: vi.fn(),
});

test("what stands out opens as the range's data arrives and closes when it is there no longer: payback glides, never jumps", async () => {
  const screen = await render(StatsAside, props(true));
  const notes = screen.getByRole("region", { name: "Auffälligkeiten" });
  const breakdown = screen.getByRole("region", { name: "Aufschlüsselung" });

  /** How far payback stands below the breakdown, whose own height glides as it loads. */
  const below = () =>
    screen.getByText("Amortisation").element().getBoundingClientRect().top -
    breakdown.element().getBoundingClientRect().bottom;

  playFrame();
  // The fonts this layout asked for are in before it is read: one swapped in later moves the text.
  below();
  await document.fonts.ready;

  const top = below();

  await screen.rerender(props(false));
  await settle(() => moves().length > 0);

  expect(below()).toBe(top);

  at(0.5);

  expect(below()).toBeGreaterThan(top);

  await finish();
  await expect.element(notes).toBeVisible();

  const open = below();

  expect(open).toBeGreaterThan(top);

  await screen.rerender(props(true));
  await settle(() => moves().length > 0);

  expect(below()).toBe(open);

  // Closed, and still there: taking it away moves nothing.
  at(1);

  expect(below()).toBe(top);

  await finish();

  expect(notes.query()).toBeNull();
  expect(below()).toBe(top);
});
