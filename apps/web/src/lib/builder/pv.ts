// The `pv` crate in the browser, as @sunreye/pv-wasm ships it (ADRs 17, 20, 25).
import type { Location, Point, Pv, Sun } from "@sunreye/pv-wasm";

// The engine's answers, as the builder and the views name them.
export type {
  Face,
  Fencing,
  Fitted,
  Footing,
  Footprint,
  Geometry,
  Ghost,
  Ground,
  InputLimits,
  Inverters,
  LaidGrid,
  Location,
  Misplaced,
  Modules,
  Mount,
  Point,
  Pv,
  RoofFace,
  Sizes,
  Sizing,
  Solid,
  Spot,
  Sun,
  Unfit,
  WallFrame,
} from "@sunreye/pv-wasm";

// The scene's own types, as the builder and the views name them (ADR 25).
export type {
  Block,
  CarPlace,
  Chimney,
  Equipment,
  Fence,
  FenceFinish,
  FencePoint,
  GridModule,
  GroundFinish,
  GroundSurface,
  Light,
  ModuleGrid,
  Obstacle,
  Opening,
  OpeningKind,
  Overhang,
  Roof,
  RoofWindow,
  Scene,
  Wall,
} from "@sunreye/scene";

/** The unit vector toward the sun: east, north, up, as the pv crate shades. */
export function sunward({ zenith, azimuth }: Sun): Point {
  const [z, a] = [(zenith * Math.PI) / 180, (azimuth * Math.PI) / 180];

  return [-Math.sin(a) * Math.sin(z), -Math.cos(a) * Math.sin(z), Math.cos(z)];
}

/** Toward the sun over `location` at `at`, ms since 1970: east, north, up. */
export function sunAt(pv: Readonly<Pick<Pv, "sun">>, location: Location, at: number): Point {
  return sunward(pv.sun(Math.floor(at / 1000), location));
}
