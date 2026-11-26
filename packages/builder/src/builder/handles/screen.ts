// The handles as the screen shows them (ADR 20): grown in with the entrance, and fitted to the
// view after each draw. On an object too small to see the ring and the arrows hide, so a press on
// it moves it; else they stand a fingertip clear of it on screen, however far the camera is.
/* oxlint-disable typescript/prefer-readonly-parameter-types -- three.js objects, set in place. */
import {
  LineBasicMaterial,
  LineLoop,
  Mesh,
  MeshBasicMaterial,
  type Group,
  type Object3D,
} from "three";
import type { Triple } from "./frame.ts";
import { handleIn } from "./gizmo.ts";
import type { Handle } from "./grips.ts";

/** Pixels an object spans below which its ring and arrows hide. */
const TINY = 24;

/** Pixels the ring and an arrow keep clear of their object at least. */
export const GAP = 20;

/** The most a ring grows by, and the most metres an arrow stands off its side. */
const GROWN = 4;
const FAR = 3;

/** Where a point of three.js's frame lands on the canvas, in pixels; null behind the camera. */
export type ToScreen = (at: Triple) => readonly [number, number] | null;

/** What the entrance and the fit scale each group by. */
const ENTERED = new WeakMap<Object3D, number>();
const FITTED = new WeakMap<Object3D, number>();

const scaled = (group: Object3D): void => {
  group.scale.setScalar((ENTERED.get(group) ?? 1) * (FITTED.get(group) ?? 1));
};

/** Shows the handles `shown` of the way in, 0 to 1: they grow and fade in from the entrance. */
export function appear(handles: Group, shown: number): void {
  for (const group of handles.children) {
    ENTERED.set(group, handleIn(group)?.grip === "move" ? 1 : 0.6 + 0.4 * shown);
    scaled(group);
    group.traverse((part) => {
      const material: unknown =
        part instanceof Mesh || part instanceof LineLoop ? part.material : undefined;

      const drawn = material instanceof MeshBasicMaterial || material instanceof LineBasicMaterial;

      // The hit bodies stay unseen.
      if (drawn && material.colorWrite) material.opacity = shown;
    });
  }
}

const along = (from: Triple, way: Triple, metres: number): Triple => [
  from[0] + way[0] * metres,
  from[1] + way[1] * metres,
  from[2] + way[2] * metres,
];

/** Pixels a metre from `at` along `way`; null where either end is behind the camera. */
function perMetre(screen: ToScreen, at: Triple, way: Triple): number | null {
  const [a, b] = [screen(at), screen(along(at, way, 1))];

  return a && b ? Math.hypot(b[0] - a[0], b[1] - a[1]) : null;
}

/** A ring's scale: clear of its object by `GAP`; null where its object is too small to see. */
function ringFit(screen: ToScreen, { at, radius = 1, inner = 0 }: Handle): number | null {
  const level = [perMetre(screen, at, [1, 0, 0]), perMetre(screen, at, [0, 0, 1])];
  const scale = Math.max(...level.map((pixels) => pixels ?? 0));

  if (2 * inner * scale < TINY) return null;

  return Math.min(Math.max((inner * scale + GAP) / (radius * scale), 1), GROWN);
}

/** Where an arrow stands: clear of its side by `GAP`; null where its object is too small to see. */
function arrowFit(screen: ToScreen, { at, axis, edge, span = 0 }: Handle): Triple | null {
  if (axis === undefined || edge === undefined) return at;

  const scale = perMetre(screen, edge, axis) ?? 0;

  if (span * scale < TINY) return null;

  const off = Math.hypot(at[0] - edge[0], at[1] - edge[1], at[2] - edge[2]);

  return along(edge, axis, Math.min(Math.max(off, GAP / scale), Math.max(off, FAR)));
}

/** Where `handle` stands in the view `screen` projects through, and what it is scaled by; null
 * where it hides. */
function fitted(handle: Handle, screen: ToScreen): { at: Triple; scale: number } | null {
  if (handle.grip !== "turn") {
    const at = arrowFit(screen, handle);

    return at && { at, scale: 1 };
  }

  const scale = ringFit(screen, handle);

  return scale === null ? null : { at: handle.at, scale };
}

/** Fits `group`, which draws `handle`, to the view `screen` projects through; whether it moved. */
function fitOne(group: Object3D, handle: Handle, screen: ToScreen): boolean {
  const found = fitted(handle, screen);
  const [x, y, z] = found?.at ?? handle.at;
  const scale = found?.scale ?? 1;
  const { position } = group;
  const before = [group.visible, FITTED.get(group) ?? 1, position.x, position.y, position.z];

  group.visible = found !== null;
  group.position.set(x, y, z);
  FITTED.set(group, scale);
  scaled(group);

  const after = [group.visible, scale, x, y, z];

  return after.some((value, at) => Math.abs(Number(value) - Number(before[at])) > 1e-3);
}

/** Fits each handle of `handles` to the view `screen` projects through; whether any moved. */
export function fit(handles: Group, screen: ToScreen): boolean {
  let moved = false;

  for (const group of handles.children) {
    const handle = handleIn(group);

    if (handle !== undefined && handle.grip !== "move")
      moved = fitOne(group, handle, screen) || moved;
  }

  return moved;
}
