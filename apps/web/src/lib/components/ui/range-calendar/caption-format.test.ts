import { describe, expect, it } from "bun:test";
import { CalendarDate } from "@internationalized/date";
import { captionMonth, captionYear } from "./caption-format";

// The caption names the month of a zone-free calendar date. It used to turn the
// date into an instant at the HOST's midnight and format that instant on the
// host's clock — right only because both halves read the same zone. The
// navigator builds its range on the plant's calendar, so the caption is handed
// that zone, and both halves must use it: an instant at Kiritimati's midnight
// (UTC+14) formatted on a UTC clock is still the previous day.
const EAST = "Pacific/Kiritimati"; // UTC+14
const WEST = "Pacific/Pago_Pago"; // UTC-11
const firstOfMarch = new CalendarDate(2026, 3, 1);
const newYearsDay = new CalendarDate(2027, 1, 1);

describe("captionMonth", () => {
  it("names the date's own month in a zone far east of UTC", () => {
    expect(captionMonth(firstOfMarch, "long", "en-US", EAST)).toBe("March");
  });

  it("names the date's own month in a zone far west of UTC", () => {
    expect(captionMonth(firstOfMarch, "long", "en-US", WEST)).toBe("March");
  });

  it("honours the requested format and locale", () => {
    expect(captionMonth(firstOfMarch, "short", "en-US", EAST)).toBe("Mar");
    expect(captionMonth(firstOfMarch, "long", "de-DE", EAST)).toBe("März");
  });

  it("hands a format function the date's 1-based month", () => {
    expect(captionMonth(firstOfMarch, (m) => `m${m}`, "en-US", EAST)).toBe("m3");
  });
});

describe("captionYear", () => {
  it("names the date's own year on either side of the date line", () => {
    expect(captionYear(newYearsDay, "numeric", "en-US", EAST)).toBe("2027");
    expect(captionYear(newYearsDay, "numeric", "en-US", WEST)).toBe("2027");
  });

  it("hands a format function the date's year", () => {
    expect(captionYear(newYearsDay, (y) => `y${y}`, "en-US", WEST)).toBe("y2027");
  });
});
