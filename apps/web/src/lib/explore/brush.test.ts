import { expect, test } from "bun:test";
import { dayOfIso } from "../range/calendar.ts";
import { rangeFor } from "../range/range.ts";
import { narrowed } from "./brush.ts";

const ZONE = "Europe/Berlin";
const D10 = dayOfIso("2026-11-10");
const at = (text: string) => Date.parse(text);

test("a drag across a day narrows to the plant-local hours it touches", () => {
  const cal = { today: D10, hour: 18, last: D10 };

  // 09:20 to 14:10 at the plant, dragged right to left.
  const got = narrowed(
    ZONE,
    cal,
    rangeFor("day", D10),
    at("2026-11-10T13:10Z"),
    at("2026-11-10T08:20Z"),
  );

  expect(got).toEqual({ kind: "custom", from: D10, to: D10 + 1, h0: 9, h1: 15 });
});

test("a drag across a week narrows to its whole days", () => {
  const cal = { today: D10 + 5, hour: 18, last: D10 + 5 };
  const week = rangeFor("week", D10);

  const got = narrowed(ZONE, cal, week, at("2026-11-10T08:20Z"), at("2026-11-12T13:10Z"));

  expect(got).toEqual({ kind: "custom", from: D10, to: D10 + 3 });
});

test("a drag that covers the range it is in narrows nothing", () => {
  const cal = { today: D10, hour: 18, last: D10 };
  const hours = { kind: "custom", from: D10, to: D10 + 1, h0: 9, h1: 10 } as const;

  expect(narrowed(ZONE, cal, hours, at("2026-11-10T08:05Z"), at("2026-11-10T08:50Z"))).toBeNull();
});
