// What a node's detail sheet reads, beyond its figure and graph (ADR 21). Pure: the sheet renders,
// this decides. A role the device does not publish gives no row, and a group without rows is
// dropped. `groups.ts` maps v3's node dialogs onto v5's roles.
import { m } from "../paraglide/messages.js";
import {
  battery,
  ev,
  generator,
  grid,
  house,
  inputs,
  inverter,
  pvTotal,
  string,
  type PvString,
} from "./groups.ts";
import { reader, type Group, type Reader, type Readings } from "./rows.ts";

/** The computed devices count down from here (ADR 15); a node reads a registered device. */
const COMPUTED = 4_294_967_292;
const PLANT = 4_294_967_294;

/** What the readings are resolved from: the live stream, the layout and capabilities. */
export interface Source extends Readings {
  readonly strings: readonly PvString[];
  /** Device names by id, which only the admin may list (ADR 9). */
  readonly names: Readonly<Record<string, string>>;
  /** "stopped" while the stream is refused: then no single row is stale on its own. */
  readonly status: "loading" | "live" | "stopped";
}

export interface NodeReadings {
  /** The device's name, when the core names it. */
  readonly device: string | null;
  /** Seconds the device has been silent, when every value of it is stale. */
  readonly silent: number | null;
  /** The sheet's own figure, W, as last read; null without one. */
  readonly lead: number | null;
  /** The sheet's own figure is an estimate. */
  readonly leadEstimated: boolean;
  readonly groups: readonly Group[];
}

/** The registered device with the most series under `prefixes`; null when none has one. */
function deviceFor(source: Source, prefixes: readonly string[]): number | null {
  let best: number | null = null;
  let most = 0;

  for (const [id, values] of Object.entries(source.values)) {
    const device = Number(id);
    const count = Object.keys(values).filter((k) => prefixes.some((p) => k.startsWith(p))).length;

    if (device < COMPUTED && count > most) {
      best = device;
      most = count;
    }
  }

  return best;
}

interface Node {
  readonly device: number | null;
  /** Where the sheet's own figure is read: the plant's total for a plant flow (ADR 14). */
  readonly lead: readonly [number | null, string];
  readonly groups: (read: Reader) => Group[];
}

/** A plant flow's node: the plant's total, and the readings of the device that measures it. */
const PLANT_NODES = new Map([
  [
    "pv",
    {
      prefixes: ["pv.", "inverter."],
      lead: "pv.power",
      groups: (r: Reader) => [inputs(r), pvTotal(r)],
    },
  ],
  ["battery", { prefixes: ["battery."], lead: "battery.power", groups: battery }],
  ["grid", { prefixes: ["grid."], lead: "grid.power", groups: grid }],
  ["house", { prefixes: ["load."], lead: "load.power", groups: house }],
  ["ev", { prefixes: ["ev."], lead: "ev.charge.power", groups: ev }],
  ["generator", { prefixes: ["generator."], lead: "generator.power", groups: generator }],
]);

const STRING = /^string-(?<id>\d+)$/u;
const LOADPOINT = /^ev-(?<id>\d+)$/u;

function node(id: string, source: Source): Node | null {
  const sid = STRING.exec(id)?.groups?.id;
  const loadpoint = LOADPOINT.exec(id)?.groups?.id;
  const flow = PLANT_NODES.get(id);

  if (sid !== undefined) {
    const n = Number(sid);
    const device = source.strings.find((s) => s.id === n)?.device ?? null;

    return {
      device,
      lead: [device, `pv.string.power[${n}]`],
      groups: (r) => string(r, source.strings, n),
    };
  }

  if (loadpoint !== undefined) {
    const device = Number(loadpoint);

    return { device, lead: [device, "ev.charge.power"], groups: ev };
  }

  if (id === "inverter") {
    const device = deviceFor(source, ["pv.", "inverter."]);

    return { device, lead: [device, "inverter.power"], groups: inverter };
  }

  if (flow === undefined) return null;

  return {
    device: deviceFor(source, flow.prefixes),
    lead: [PLANT, flow.lead],
    groups: flow.groups,
  };
}

/** Seconds since a device last delivered, when every value of it is stale. */
function silence(source: Source, device: number): number | null {
  const values = Object.keys(source.values[device] ?? {});
  const stale = source.stale[device] ?? {};

  if (values.length === 0 || values.some((k) => stale[k] === undefined)) return null;

  return Math.round((source.now - Math.max(...Object.values(stale))) / 1000);
}

/** A node's readings, or null when the sheet is not a node's (a day figure, the price). */
export function nodeReadings(id: string, source: Source): NodeReadings | null {
  const found = node(id, source);

  if (found === null) return null;

  const [leadDevice, leadKey] = found.lead;
  const lead = leadDevice === null ? null : (source.values[leadDevice]?.[leadKey] ?? null);

  const leadEstimated =
    leadDevice !== null && (source.estimated[leadDevice] ?? []).includes(leadKey);

  if (found.device === null) return { device: null, silent: null, lead, leadEstimated, groups: [] };

  const silent = silence(source, found.device);
  // One notice covers a silent device or a stopped stream; a row's own age is for the exception.
  const read = reader(source, found.device, silent !== null || source.status !== "live");

  const groups = found
    .groups(read)
    .filter((g) => g.rows.length > 0 || g.table !== undefined || g.note !== undefined);

  return { device: source.names[found.device] ?? null, silent, lead, leadEstimated, groups };
}

/** "vor 42 s", "vor 4 min", "vor 3 h": how old a reading is. */
export function ago(seconds: number): string {
  if (seconds < 90) return m.rd_ago_s({ n: seconds });

  if (seconds < 90 * 60) return m.rd_ago_min({ n: Math.round(seconds / 60) });

  return m.rd_ago_h({ n: Math.round(seconds / 3600) });
}
