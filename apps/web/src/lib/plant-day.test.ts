import { expect, test } from "bun:test";
import { plantMidnight } from "./plant-day.ts";

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
