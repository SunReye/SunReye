// What the builder calls each kind of roof, obstacle, finish, opening and wall (ADR 20).
import { m } from "../paraglide/messages.js";
import type {
  FenceFinish,
  GroundFinish,
  Obstacle,
  OpeningKind,
  Roof,
  Unfit,
  Wall,
} from "@sunreye/builder/builder/pv.ts";

export const ROOFS: readonly (readonly [Roof["kind"], () => string])[] = [
  ["flat", m.roof_flat],
  ["monoPitch", m.roof_monoPitch],
  ["gable", m.roof_gable],
  ["hip", m.roof_hip],
];

export const OBSTACLES: Readonly<Record<Obstacle["kind"], () => string>> = {
  box: m.obstacle_box,
  cylinder: m.obstacle_cylinder,
  tree: m.obstacle_tree,
  hedge: m.obstacle_hedge,
};

export const GROUND_FINISHES: readonly (readonly [GroundFinish, () => string])[] = [
  ["lawn", m.finish_lawn],
  ["paving", m.finish_paving],
  ["driveway", m.finish_driveway],
  ["gravel", m.finish_gravel],
  ["path", m.finish_path],
];

export const FENCE_FINISHES: readonly (readonly [FenceFinish, () => string])[] = [
  ["wood", m.finish_wood],
  ["metal", m.finish_metal],
  ["wall", m.finish_wall],
];

/** Why an opening cannot be as asked, in words. */
export const UNFIT: Readonly<Record<Unfit, () => string>> = {
  overlap: m.opening_refused_overlap,
  room: m.opening_refused_room,
};

export const OPENING_KINDS: readonly (readonly [OpeningKind, () => string])[] = [
  ["window", m.opening_window],
  ["frenchWindow", m.opening_french_window],
  ["frontDoor", m.opening_front_door],
  ["garageDoor", m.opening_garage_door],
];

export const WALL_NAMES: readonly (readonly [Wall, () => string])[] = [
  ["front", m.wall_front],
  ["right", m.wall_right],
  ["back", m.wall_back],
  ["left", m.wall_left],
];

export const named = <T>(list: readonly (readonly [T, () => string])[], key: T): string =>
  list.find(([kind]) => kind === key)?.[1]() ?? "";
