// What the inspector lists and calls each level (ADR 20): its titles, and a group's rows.
import type { Device } from "../api/core.ts";
import { m } from "../paraglide/messages.js";
import { getLocale } from "../paraglide/runtime.js";
import type { Cold, StringRefusal } from "./checks.ts";
import { moduleOf, parent, type Level, type Section } from "./levels.ts";
import { painted, type Draft } from "./modules.ts";
import {
  FENCE_FINISHES,
  GROUND_FINISHES,
  named,
  OBSTACLES,
  OPENING_KINDS,
  ROOFS,
  WALL_NAMES,
} from "./names.ts";
import type { Fence, Modules, Pv, Sizes } from "./pv.ts";

export { FENCE_FINISHES, GROUND_FINISHES, OPENING_KINDS, ROOFS, WALL_NAMES } from "./names.ts";

/** What the inspector reads besides the level. */
export interface Plan {
  readonly draft: Draft;
  /** The crate's layout of the draft's grids. */
  readonly laid: Modules;
  /** The crate, which places a new opening, keeps a changed one on its wall and fills a face. */
  readonly pv: Pick<Pv, "place" | "refit" | "fillFace">;
  /** Each module type's size, by its id, as the crate lays modules out. */
  readonly sizes: Sizes;
  readonly devices: readonly Readonly<Device>[];
  /** The strings over their inverter's limit in the cold, as the crate reckons them. */
  readonly cold: readonly Cold[];
  /** The string the last save was refused for, until the next edit. */
  readonly refused: StringRefusal | null;
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

/** How long a list the scene may leave out is. */
const many = (list: readonly unknown[] | undefined): number => list?.length ?? 0;

/** A fence's length along its points, in metres. */
function length({ points }: Fence): number {
  return points.reduce((sum, point, i) => {
    const before = points[i - 1] ?? point;

    return sum + Math.hypot(point.x - before.x, point.z - before.z);
  }, 0);
}

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
      count:
        draft.scene.obstacles.length +
        (draft.scene.surfaces?.length ?? 0) +
        (draft.scene.fences?.length ?? 0),
    }),
  equipment: ({ draft }) =>
    m.builder_summary_equipment({
      markers: many(draft.scene.equipment),
      places: many(draft.scene.carPlaces),
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

  const chimneys = (draft.scene.chimneys ?? []).map((item, index): Entry => ({
    level: { kind: "chimney", index },
    label: m.builder_item({ name: m.chimney(), number: index + 1 }),
    summary: m.builder_chimney_summary({
      block: item.block + 1,
      face: item.face + 1,
      height: number.format(item.height),
    }),
  }));

  const openings = (draft.scene.openings ?? []).map((item, index): Entry => ({
    level: { kind: "opening", index },
    label: m.builder_item({ name: named(OPENING_KINDS, item.kind), number: index + 1 }),
    summary: m.builder_opening_summary({
      block: item.block + 1,
      wall: named(WALL_NAMES, item.wall),
      width: number.format(item.width),
      height: number.format(item.height),
    }),
  }));

  const blocks = draft.scene.blocks.map((block, index): Entry => ({
    level: { kind: "block", index },
    label: m.builder_block({ number: index + 1 }),
    summary: m.builder_block_summary({
      roof: ROOFS.find(([kind]) => kind === block.roof.kind)?.[1]() ?? "",
      width: number.format(block.width),
      depth: number.format(block.depth),
    }),
  }));

  return [...blocks, ...chimneys, ...openings];
}

function surroundings({ draft }: Plan): Entry[] {
  const number = format();

  const obstacles = draft.scene.obstacles.map((item, index): Entry => ({
    level: { kind: "obstacle", index },
    label: m.builder_item({ name: OBSTACLES[item.kind](), number: index + 1 }),
    summary: m.builder_height_summary({ height: number.format(item.height) }),
  }));

  const surfaces = (draft.scene.surfaces ?? []).map((item, index): Entry => {
    const finish = named(GROUND_FINISHES, item.finish);

    return {
      level: { kind: "surface", index },
      label: m.builder_item({ name: finish, number: index + 1 }),
      summary: m.builder_block_summary({
        roof: finish,
        width: number.format(item.width),
        depth: number.format(item.depth),
      }),
    };
  });

  const fences = (draft.scene.fences ?? []).map((item, index): Entry => ({
    level: { kind: "fence", index },
    label: m.builder_item({ name: m.fence(), number: index + 1 }),
    summary: m.builder_fence_summary({
      finish: named(FENCE_FINISHES, item.finish),
      length: number.format(length(item)),
    }),
  }));

  return [imported(draft), ...obstacles, ...surfaces, ...fences];
}

/** The imported surroundings' row: always there, as it is where they are loaded. */
function imported({ scene }: Draft): Entry {
  return {
    level: { kind: "import" },
    label: m.builder_import(),
    summary: scene.imported
      ? m.builder_import_summary({ hidden: scene.imported.hidden?.length ?? 0 })
      : m.builder_import_none(),
  };
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

  if (level.kind === "module") return m.builder_cell({ number: level.module + 1 });

  const up = parent(level);
  const key = JSON.stringify(level);
  const rows = up.kind === "section" ? entries(up.section, plan) : [];

  return rows.find((entry) => JSON.stringify(entry.level) === key)?.label ?? "";
}

/** How many objects of each kind the plan holds, by level kind. */
function counts({
  draft,
}: Plan): Readonly<
  Record<
    | "block"
    | "chimney"
    | "opening"
    | "obstacle"
    | "surface"
    | "fence"
    | "marker"
    | "place"
    | "string",
    number
  >
> {
  const { scene } = draft;

  return {
    block: scene.blocks.length,
    chimney: many(scene.chimneys),
    opening: many(scene.openings),
    obstacle: scene.obstacles.length,
    surface: many(scene.surfaces),
    fence: many(scene.fences),
    marker: many(scene.equipment),
    place: many(scene.carPlaces),
    string: draft.strings.length,
  };
}

/** Whether a level's object is still in the plan: an undo or a removal can take it away. */
export function exists(level: Level, plan: Plan): boolean {
  if (level.kind === "root" || level.kind === "section" || level.kind === "import") return true;

  if (level.kind === "face") {
    return plan.laid.roofs.some(({ block, face }) => block === level.block && face === level.face);
  }

  if (level.kind === "module") return moduleOf(plan.draft.scene, level) !== undefined;

  return level.index < counts(plan)[level.kind];
}
