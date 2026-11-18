// A figure's detail sheet as its row says, or for a string or a loadpoint as the layout and the
// device say (ADR 21). Pure.
import { PLANT, type PvString } from "../api/core.ts";
import { m } from "../paraglide/messages.js";
import { parseFigure, type Figure } from "./figures.ts";
import {
  EV,
  ROWS,
  SOLAR,
  type Analytics,
  type Charted,
  type Onward,
  type Sheet,
} from "./sheets.ts";

/** History's default view. */
const DEFAULT: Onward = { metric: null, tab: null, sid: null };

/** The figure `id` names: a fixed one, `string-<id>` or `ev-<device>`; null for none. */
export function figure(id: string): Figure | null {
  const ref = parseFigure(id);

  if (ref === null) return null;

  if (ref.kind === "string") return { colour: SOLAR, node: id, chart: null };

  if (ref.kind === "ev") return { ...EV, node: id };

  return ROWS[ref.id].figure;
}

/**
 * The sheet title of figure `id`: a string's and a loadpoint's are their names.
 * @param strings the layout's strings
 * @param device a device's name, which only the admin may list (ADR 9)
 */
export function titleOf(
  id: string,
  strings: readonly Readonly<{ id: number; name: string }>[],
  device: (id: number) => string | undefined,
): string {
  const ref = parseFigure(id);

  if (ref === null) return "";

  if (ref.kind === "fixed") return ROWS[ref.id].title();

  if (ref.kind === "ev") return device(ref.id) ?? m.dash_ev();

  return strings.find((s) => s.id === ref.id)?.name ?? m.detail_pv();
}

/** A loadpoint's sheet: its own charging power (ADR 10). */
function loadpoint(device: number, look: Figure): Sheet {
  const series = "ev.charge.power";

  return {
    figure: look,
    analytics: {
      device,
      series,
      heat: series,
      way: null,
      compare: false,
      string: null,
      forecast: [],
    },
    head: { kind: "energy", device, series },
    panel: { kind: "ev" },
    facts: null,
    history: DEFAULT,
  };
}

/** A string's sheet: its own series under its inverter; none for a string not in the layout. */
function stringSheet(id: number, look: Figure, strings: readonly Readonly<PvString>[]): Sheet {
  const s = strings.find((x: Readonly<PvString>) => x.id === id);
  const series = `pv.string.power[${id}]`;
  const history: Onward = { metric: "plant", tab: "strings", sid: String(id) };

  if (s === undefined)
    return { figure: look, analytics: null, head: null, panel: null, facts: null, history };

  return {
    figure: look,
    analytics: {
      device: s.device,
      series,
      heat: series,
      way: null,
      compare: strings.length > 1,
      string: id,
      // Stored under its inverter, beside its history (ADR 17).
      forecast: [s.device],
    },
    head: { kind: "energy", device: s.device, series },
    panel: { kind: "pv", inverter: false },
    facts: null,
    history,
  };
}

/** A fixed figure's charted series, its strings compared and its forecast read where it is PV's. */
function analyticsOf(c: Charted | null, strings: readonly Readonly<PvString>[]): Analytics | null {
  if (c === null) return null;

  return {
    device: PLANT,
    series: c.series,
    heat: c.heat,
    way: c.way?.() ?? null,
    compare: c.pv === true && strings.length > 1,
    string: null,
    forecast: c.pv === true ? [...new Set(strings.map((s) => s.device))] : [],
  };
}

/** The sheet of figure `id` over the layout's `strings`; null for an id naming no figure. */
export function sheetOf(id: string, strings: readonly Readonly<PvString>[]): Sheet | null {
  const ref = parseFigure(id);
  const shown = figure(id);

  if (ref === null || shown === null) return null;

  if (ref.kind === "string") return stringSheet(ref.id, shown, strings);

  if (ref.kind === "ev") return loadpoint(ref.id, shown);

  const row = ROWS[ref.id];

  return {
    figure: row.figure,
    analytics: analyticsOf(row.charted, strings),
    head: row.head,
    panel: row.panel,
    facts: row.facts ?? null,
    history: { ...DEFAULT, ...row.history },
  };
}
