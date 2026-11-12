import { expect, test } from "bun:test";
import { dayOf } from "../range/calendar.ts";
import { rangeFor } from "../range/range.ts";
import { notesOf } from "./notes.ts";

const TODAY = dayOf(2026, 10, 12);
const UTC = "UTC";
const H = 3_600_000;
const T = (day: number, h: number) => (day * 24 + h) * H;

const row = (name: string, flag: "weak" | "face" | null, ratio: number | null = null) => ({
  name,
  flag,
  ratio,
});

test("a weak string, then a gap that opens its day, then the strongest band", () => {
  const notes = notesOf({
    zone: UTC,
    gaps: [{ start: T(TODAY - 3, 2), end: T(TODAY - 3, 7) }],
    strings: [row("Süd", "weak", 0.85), row("West", null)],
    best: { title: "Mi., 4. November", value: 31.2, drill: rangeFor("day", TODAY - 8) },
  });

  expect(notes.map((n) => n.tone)).toEqual(["warn", "warn", "info"]);
  expect(notes[0]).toMatchObject({ text: "Süd liefert −15 % zum Modell.", view: "strings" });
  expect(notes[1]).toMatchObject({ range: rangeFor("day", TODAY - 3) });
  expect(notes[1]!.text).toStartWith("5 h ohne Daten ab ");
  expect(notes[2]!.text).toBe("Stärkster Abschnitt: Mi., 4. November mit 31,2 kWh.");
});

test("at most three, and nothing to say is nothing", () => {
  expect(notesOf({ zone: UTC, gaps: [], strings: [], best: null })).toEqual([]);

  const many = notesOf({
    zone: UTC,
    gaps: [{ start: T(TODAY, 1), end: T(TODAY, 3) }],
    strings: [row("A", "weak", 0.8), row("B", "face")],
    best: { title: "x", value: 1, drill: rangeFor("day", TODAY) },
  });

  expect(many).toHaveLength(3);
});
