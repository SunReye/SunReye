// What each inspector group can add, and the level the new object opens at (ADR 20).
import { m } from "../paraglide/messages.js";
import { chimney, fence, nextBlock, obstacle, surface } from "./draft.ts";
import type { Level, Section } from "./levels.ts";
import { addString, type Draft } from "./modules.ts";
import type { Plan } from "./outline.ts";
import type { Equipment, Obstacle, OpeningKind } from "./pv.ts";
import { fresh } from "./wall-openings.ts";

/** One add button: the draft with the new object, and its level. */
export interface Addition {
  readonly label: string;
  readonly draft: Draft;
  readonly level: Level;
}

/** A chimney goes on the first roof face; without a roof, none is added. Windows and doors go
 * on the walls. */
function buildings({ draft, laid }: Plan): Addition[] {
  const { blocks, chimneys = [] } = draft.scene;
  const [face] = laid.roofs;

  const block: Addition = {
    label: m.builder_add_block(),
    draft: { ...draft, scene: { ...draft.scene, blocks: [...blocks, nextBlock(blocks)] } },
    level: { kind: "block", index: blocks.length },
  };

  const onRoof: Addition[] =
    face === undefined
      ? []
      : [
          {
            label: m.builder_add_chimney(),
            draft: { ...draft, scene: { ...draft.scene, chimneys: [...chimneys, chimney(face)] } },
            level: { kind: "chimney", index: chimneys.length },
          },
        ];

  return [block, ...onRoof, ...onWalls(draft)];
}

const OPENINGS: readonly (readonly [OpeningKind, () => string])[] = [
  ["window", m.builder_add_window],
  ["frenchWindow", m.builder_add_french_window],
  ["frontDoor", m.builder_add_front_door],
  ["garageDoor", m.builder_add_garage_door],
];

/** A window or a door goes in the first free place on a wall; without room for it, none is
 * added. */
function onWalls(draft: Draft): Addition[] {
  const openings = draft.scene.openings ?? [];

  return OPENINGS.flatMap(([kind, label]): Addition[] => {
    const made = fresh(draft.scene, kind);

    return made === null
      ? []
      : [
          {
            label: label(),
            draft: { ...draft, scene: { ...draft.scene, openings: [...openings, made] } },
            level: { kind: "opening", index: openings.length },
          },
        ];
  });
}

const OBSTACLES: readonly (readonly [Obstacle["kind"], () => string])[] = [
  ["box", m.builder_add_box],
  ["cylinder", m.builder_add_cylinder],
  ["tree", m.builder_add_tree],
  ["hedge", m.builder_add_hedge],
];

function surroundings({ draft }: Plan): Addition[] {
  const { obstacles, surfaces = [], fences = [] } = draft.scene;

  const solid = OBSTACLES.map(([kind, label]): Addition => ({
    label: label(),
    draft: { ...draft, scene: { ...draft.scene, obstacles: [...obstacles, obstacle(kind)] } },
    level: { kind: "obstacle", index: obstacles.length },
  }));

  return [
    ...solid,
    {
      label: m.builder_add_surface(),
      draft: { ...draft, scene: { ...draft.scene, surfaces: [...surfaces, surface()] } },
      level: { kind: "surface", index: surfaces.length },
    },
    {
      label: m.builder_add_fence(),
      draft: { ...draft, scene: { ...draft.scene, fences: [...fences, fence()] } },
      level: { kind: "fence", index: fences.length },
    },
  ];
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
