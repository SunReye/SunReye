import { expect, test } from "bun:test";
import { current, headline, priceLevel } from "./now.ts";

test("the headline is PV power while PV produces", () => {
  expect(headline({ "pv.power": 4200, "load.power": 900 })).toEqual({
    subject: "production",
    watts: 4200,
  });
});

test("the headline switches to house consumption while PV is idle", () => {
  expect(headline({ "pv.power": 0, "load.power": 900 })).toEqual({
    subject: "consumption",
    watts: 900,
  });
  expect(headline({ "load.power": 900 })).toEqual({ subject: "consumption", watts: 900 });
});

test("before the first reading the headline is production without a value", () => {
  expect(headline()).toEqual({ subject: "production", watts: null });
});

test("a price is cheap in the day's lowest third and dear in its highest", () => {
  const day = [0.05, 0.08, 0.1, 0.12, 0.15, 0.2];

  expect(priceLevel(0.06, day)).toBe("cheap");
  expect(priceLevel(0.11, day)).toBe("normal");
  expect(priceLevel(0.19, day)).toBe("dear");
});

test("a price without a day to compare is not judged", () => {
  expect(priceLevel(0.1, [])).toBeNull();
  expect(priceLevel(0.1, [0.1, 0.1, 0.1])).toBe("normal");
});

test("the price now is the target that began last", () => {
  const targets = [
    { target: "2026-11-12T10:00:00Z", value: 7 },
    { target: "2026-11-12T10:15:00Z", value: 8 },
    { target: "2026-11-12T10:30:00Z", value: 9 },
  ];

  expect(current(targets, new Date("2026-11-12T10:20:00Z"))).toBe(8);
  expect(current(targets, new Date("2026-11-12T09:50:00Z"))).toBeNull();
});
