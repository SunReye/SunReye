// At most three things about a range worth a look, the exceptional first, each leading to its
// cause: a string under its model, a gap in the record, the strongest band. Pure.
import type { StringRow } from "../analytics/strings.ts";
import { m } from "../paraglide/messages.js";
import { plantNow } from "../plant-day.ts";
import { fmt } from "../range/calendar.ts";
import type { Span } from "../range/fill.ts";
import { kwh } from "../range/format.ts";
import { rangeFor, type Range } from "../range/range.ts";
import { delta } from "./words.ts";

export interface Note {
  readonly tone: "warn" | "info";
  readonly text: string;
  readonly action: string;
  /** Where it leads: a range to open, or the plant's strings. */
  readonly range?: Range;
  readonly view?: "strings";
}

export interface NoteInput {
  readonly zone: string;
  /** In ms since the epoch. */
  readonly gaps: readonly Span[];
  readonly strings: readonly Pick<StringRow, "name" | "flag" | "ratio">[];
  readonly best: { readonly title: string; readonly value: number; readonly drill: Range } | null;
}

const HOUR = 3_600_000;

function gapNote(zone: string, gap: Span): Note {
  const { day, hour } = plantNow(zone, new Date(gap.start));

  return {
    tone: "warn",
    text: m.stats_note_gap({
      hours: Math.round((gap.end - gap.start) / HOUR),
      from: `${fmt("dayShort", day)}, ${hour}:00`,
    }),
    action: m.stats_note_gap_action(),
    range: rangeFor("day", day),
  };
}

export function notesOf(input: NoteInput): Note[] {
  const out: Note[] = [];
  const weak = input.strings.find((s) => s.flag === "weak");
  const face = input.strings.find((s) => s.flag === "face");
  const strings = { action: m.stats_note_strings_action(), view: "strings" as const };

  if (weak)
    out.push({
      tone: "warn",
      text: m.stats_note_weak({ name: weak.name, delta: delta((weak.ratio ?? 1) - 1) }),
      ...strings,
    });

  const gap = input.gaps[0];

  if (gap) out.push(gapNote(input.zone, gap));

  const best = input.best;

  if (best)
    out.push({
      tone: "info",
      text: m.stats_note_best({ title: best.title, energy: kwh(best.value) }),
      action: m.stats_note_open(),
      range: best.drill,
    });

  if (face) out.push({ tone: "info", text: m.stats_note_face({ name: face.name }), ...strings });

  return out.slice(0, 3);
}
