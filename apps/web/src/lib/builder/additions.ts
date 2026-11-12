// What each inspector group can add, and the level the new object opens at (ADR 20).
import { m } from "../paraglide/messages.js";
import { nextBlock, obstacle } from "./draft.ts";
import type { Level, Section } from "./levels.ts";
import { addString, type Draft } from "./modules.ts";
import type { Plan } from "./outline.ts";
import type { Equipment, Obstacle } from "./pv.ts";

/** One add button: the draft with the new object, and its level. */
export interface Addition {
  readonly label: string;
  readonly draft: Draft;
  readonly level: Level;
}

function buildings({ draft }: Plan): Addition[] {
  const { blocks } = draft.scene;

  return [
    {
      label: m.builder_add_block(),
      draft: { ...draft, scene: { ...draft.scene, blocks: [...blocks, nextBlock(blocks)] } },
      level: { kind: "block", index: blocks.length },
    },
  ];
}

const OBSTACLES: readonly (readonly [Obstacle["kind"], () => string])[] = [
  ["box", m.builder_add_box],
  ["cylinder", m.builder_add_cylinder],
  ["tree", m.builder_add_tree],
];

function surroundings({ draft }: Plan): Addition[] {
  const { obstacles } = draft.scene;

  return OBSTACLES.map(([kind, label]) => ({
    label: label(),
    draft: { ...draft, scene: { ...draft.scene, obstacles: [...obstacles, obstacle(kind)] } },
    level: { kind: "obstacle", index: obstacles.length },
  }));
}

const MARKERS: readonly (readonly [Equipment["kind"], () => string])[] = [
  ["inverter", m.builder_place_inverter],
  ["battery", m.builder_place_battery],
];

/** Markers name the first device, places the first EVCC loadpoint (ADR 10); none, none added. */
function equipment({ draft, devices }: Plan): Addition[] {
  const markers = draft.scene.equipment ?? [];
  const places = draft.scene.carPlaces ?? [];
  const device = devices[0]?.id;
  const loadpoint = devices.find(({ profile }) => profile === "evcc")?.id;

  const placements =
    device === undefined
      ? []
      : MARKERS.map(([kind, label]): Addition => {
          const marker = {
            device,
            kind,
            block: 0,
            wall: "front",
            along: 1,
            inside: false,
          } as const;

          return {
            label: label(),
            draft: { ...draft, scene: { ...draft.scene, equipment: [...markers, marker] } },
            level: { kind: "marker", index: markers.length },
          };
        });

  const place = { device: loadpoint ?? 0, x: 0, z: 10, width: 2.5, length: 5, rotation: 0 };

  return loadpoint === undefined
    ? placements
    : [
        ...placements,
        {
          label: m.builder_add_car_place(),
          draft: { ...draft, scene: { ...draft.scene, carPlaces: [...places, place] } },
          level: { kind: "place", index: places.length },
        },
      ];
}

/** A new string takes the first grid's module type, else the first type; none, none added. */
function strings({ draft }: Plan, moduleType: number | undefined): Addition[] {
  const type = draft.scene.grids?.[0]?.moduleType ?? moduleType;

  if (type === undefined) return [];

  const name = m.builder_string_default({ number: draft.strings.length + 1 });

  return [
    {
      label: m.builder_add_string(),
      draft: addString(draft, name, type),
      level: { kind: "string", index: draft.strings.length },
    },
  ];
}

/** The add buttons under a group's rows; modules are placed on a face's own level. */
export function additions(
  section: Section,
  plan: Plan,
  moduleType: number | undefined,
): Addition[] {
  const lists: Readonly<Record<Section, () => Addition[]>> = {
    buildings: () => buildings(plan),
    surroundings: () => surroundings(plan),
    equipment: () => equipment(plan),
    modules: () => [],
    strings: () => strings(plan, moduleType),
  };

  return lists[section]();
}
