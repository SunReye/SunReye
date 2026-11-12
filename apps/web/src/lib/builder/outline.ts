// What the inspector lists and calls each level (ADR 20): its titles, and a group's rows.
import type { Device } from "../api/core.ts";
import { m } from "../paraglide/messages.js";
import { getLocale } from "../paraglide/runtime.js";
import type { Cold } from "./checks.ts";
import { parent, type Level, type Section } from "./levels.ts";
import { painted, type Draft } from "./modules.ts";
import type { Modules, Obstacle, Roof } from "./pv.ts";

/** What the inspector reads besides the level. */
export interface Plan {
  readonly draft: Draft;
  /** The crate's layout of the draft's grids. */
  readonly laid: Modules;
  readonly devices: readonly Readonly<Device>[];
  /** The strings over their inverter's limit in the cold, as the crate reckons them. */
  readonly cold: readonly Cold[];
}

/** A row that drills to `level`. */
export interface Entry {
  readonly level: Level;
  readonly label: string;
  readonly summary: string;
}

export const SECTIONS: Readonly<Record<Section, () => string>> = {
  buildings: m.builder_buildings,
  surroundings: m.builder_surroundings,
  equipment: m.builder_equipment,
  modules: m.builder_modules,
  strings: m.builder_strings,
};

export const ROOFS: readonly (readonly [Roof["kind"], () => string])[] = [
  ["flat", m.roof_flat],
  ["monoPitch", m.roof_monoPitch],
  ["gable", m.roof_gable],
  ["hip", m.roof_hip],
];

const OBSTACLES: Readonly<Record<Obstacle["kind"], () => string>> = {
  box: m.obstacle_box,
  cylinder: m.obstacle_cylinder,
  tree: m.obstacle_tree,
};

const KINDS = { inverter: m.equipment_inverter, battery: m.equipment_battery } as const;

const format = (): Intl.NumberFormat =>
  new Intl.NumberFormat(getLocale(), { maximumFractionDigits: 1 });

function deviceName(devices: readonly Readonly<Device>[], id: number): string {
  return devices.find((device) => device.id === id)?.name ?? String(id);
}

/** How many modules the grids hold, and how many of them no string. */
export function placed(draft: Draft) {
  const cells = (draft.scene.grids ?? []).flatMap((grid) => grid.modules);

  return {
    count: cells.length,
    unassigned: cells.filter((cell) => (cell.string ?? undefined) === undefined).length,
  };
}

const SUMMARIES: Readonly<Record<Section, (plan: Plan) => string>> = {
  buildings: ({ draft }) => m.builder_summary_buildings({ count: draft.scene.blocks.length }),
  surroundings: ({ draft }) =>
    m.builder_summary_surroundings({
      north: Math.round(draft.scene.north),
      count: draft.scene.obstacles.length,
    }),
  equipment: ({ draft }) =>
    m.builder_summary_equipment({
      markers: draft.scene.equipment?.length ?? 0,
      places: draft.scene.carPlaces?.length ?? 0,
    }),
  modules: ({ draft }) => m.builder_summary_modules(placed(draft)),
  strings: ({ draft }) => m.builder_summary_strings({ count: draft.strings.length }),
};

/** A group's values in a few words, under its root row. */
export function summary(section: Section, plan: Plan): string {
  return SUMMARIES[section](plan);
}

function buildings({ draft }: Plan): Entry[] {
  const number = format();

  return draft.scene.blocks.map((block, index) => ({
    level: { kind: "block", index },
    label: m.builder_block({ number: index + 1 }),
    summary: m.builder_block_summary({
      roof: ROOFS.find(([kind]) => kind === block.roof.kind)?.[1]() ?? "",
      width: number.format(block.width),
      depth: number.format(block.depth),
    }),
  }));
}

function surroundings({ draft }: Plan): Entry[] {
  const number = format();

  return draft.scene.obstacles.map((item, index) => ({
    level: { kind: "obstacle", index },
    label: m.builder_item({ name: OBSTACLES[item.kind](), number: index + 1 }),
    summary: m.builder_height_summary({ height: number.format(item.height) }),
  }));
}

function equipment({ draft, devices }: Plan): Entry[] {
  const markers = (draft.scene.equipment ?? []).map((marker, index): Entry => ({
    level: { kind: "marker", index },
    label: m.builder_item({ name: KINDS[marker.kind](), number: index + 1 }),
    summary: deviceName(devices, marker.device),
  }));

  const places = (draft.scene.carPlaces ?? []).map((place, index): Entry => ({
    level: { kind: "place", index },
    label: m.car_place({ number: index + 1 }),
    summary: deviceName(devices, place.device),
  }));

  return [...markers, ...places];
}

function modules({ draft, laid }: Plan): Entry[] {
  return laid.roofs.map(({ block, face, azimuth, tilt }) => ({
    level: { kind: "face", block, face },
    label: m.builder_face_item({ block: block + 1, face: face + 1 }),
    summary: m.builder_face_summary({
      azimuth: Math.round(azimuth),
      tilt: Math.round(tilt),
      count:
        draft.scene.grids?.find((grid) => grid.block === block && grid.face === face)?.modules
          .length ?? 0,
    }),
  }));
}

function strings({ draft }: Plan): Entry[] {
  return draft.strings.map((string, index) => ({
    level: { kind: "string", index },
    label: string.name,
    summary: m.builder_string_modules(painted(draft.scene, index)),
  }));
}

const LISTS: Readonly<Record<Section, (plan: Plan) => Entry[]>> = {
  buildings,
  surroundings,
  equipment,
  modules,
  strings,
};

/** A group's rows, each drilling to one of its objects. */
export function entries(section: Section, plan: Plan): Entry[] {
  return LISTS[section](plan);
}

/** A level's name: its header, and its children's back button; an object's is its row's. */
export function title(level: Level, plan: Plan): string {
  if (level.kind === "root") return m.builder_inspector();

  if (level.kind === "section") return SECTIONS[level.section]();

  const up = parent(level);
  const key = JSON.stringify(level);
  const rows = up.kind === "section" ? entries(up.section, plan) : [];

  return rows.find((entry) => JSON.stringify(entry.level) === key)?.label ?? "";
}

/** How many objects of each kind the plan holds, by level kind. */
function counts({
  draft,
}: Plan): Readonly<Record<"block" | "obstacle" | "marker" | "place" | "string", number>> {
  const { scene } = draft;

  return {
    block: scene.blocks.length,
    obstacle: scene.obstacles.length,
    marker: scene.equipment?.length ?? 0,
    place: scene.carPlaces?.length ?? 0,
    string: draft.strings.length,
  };
}

/** Whether a level's object is still in the plan: an undo or a removal can take it away. */
export function exists(level: Level, plan: Plan): boolean {
  if (level.kind === "root" || level.kind === "section") return true;

  if (level.kind === "face") {
    return plan.laid.roofs.some(({ block, face }) => block === level.block && face === level.face);
  }

  return level.index < counts(plan)[level.kind];
}
