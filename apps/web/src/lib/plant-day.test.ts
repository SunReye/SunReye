import { expect, test } from "bun:test";
import { plantInstant, plantMidnight, plantNow } from "./plant-day.ts";

test("today starts at the plant's midnight, not the viewer's", () => {
  // 00:30 in Berlin is still the 11th in UTC.
  const now = new Date("2026-11-11T23:30:00Z");

  expect(plantMidnight("Europe/Berlin", now).toISOString()).toBe("2026-11-11T23:00:00.000Z");
  expect(plantMidnight("UTC", now).toISOString()).toBe("2026-11-11T00:00:00.000Z");
  expect(plantMidnight("America/New_York", now).toISOString()).toBe("2026-11-11T05:00:00.000Z");
});

test("a day that changes its offset starts at the offset of its midnight", () => {
  // Berlin's clocks went back at 03:00 on 2026-10-25: midnight was still summer time.
  const evening = new Date("2026-10-25T20:00:00Z");

  expect(plantMidnight("Europe/Berlin", evening).toISOString()).toBe("2026-10-24T22:00:00.000Z");

  // and forward at 02:00 on 2026-03-29: midnight was winter time.
  const noon = new Date("2026-03-29T10:00:00Z");

  expect(plantMidnight("Europe/Berlin", noon).toISOString()).toBe("2026-03-28T23:00:00.000Z");
});

test("a plant-local calendar day and hour name one instant", () => {
  // 2026-11-12 is day 20769 since 1970-01-01.
  expect(plantInstant("Europe/Berlin", 20_769, 0).toISOString()).toBe("2026-11-11T23:00:00.000Z");
  expect(plantInstant("Europe/Berlin", 20_769, 24).toISOString()).toBe("2026-11-12T23:00:00.000Z");
  expect(plantInstant("UTC", 20_769, 8).toISOString()).toBe("2026-11-12T08:00:00.000Z");
});

test("an hour after a change of offset keeps its wall-clock time", () => {
  // Berlin left summer time at 03:00 on 2026-10-25 (day 20751).
  expect(plantInstant("Europe/Berlin", 20_751, 12).toISOString()).toBe("2026-10-25T11:00:00.000Z");
});

test("now falls on a plant-local day and hour", () => {
  const now = new Date("2026-11-11T23:30:00Z");

  expect(plantNow("Europe/Berlin", now)).toEqual({ day: 20_769, hour: 0 });
  expect(plantNow("UTC", now)).toEqual({ day: 20_768, hour: 23 });
});
