// The scene's bodies drawn one mesh each, the round obstacles and the equipment markers, and the
// scene obstacle each drawn mesh shows (ADR 20), so a strike on it names the obstacle. That is
// kept beside the meshes, not on them: three.js's `userData` is untyped.
import { CylinderGeometry, Mesh, type Object3D } from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import * as finish from "../scene/materials.ts";
import { conifer, crown } from "../scene/surfaces.ts";
import { toThree } from "./panels.ts";
import type { Mount, Solid } from "./pv.ts";

/** By mesh: the obstacle a struck triangle of it belongs to; −1 for none. */
const owners = new WeakMap<Object3D, (triangle: number) => number>();

/** Names the obstacle all of `mesh` shows. */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- the key only.
function own(mesh: Object3D, obstacle: number): void {
  owners.set(mesh, () => obstacle);
}

/** Names the obstacle each triangle of `mesh` shows, in its order. */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- the key only.
export function ownEach(mesh: Object3D, obstacles: readonly number[]): void {
  owners.set(mesh, (triangle) => obstacles[triangle] ?? -1);
}

/** The obstacle triangle `triangle` of `mesh` shows; −1 for none, or a mesh of no obstacle. */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- the key only.
export function ownerOf(mesh: Object3D, triangle: number | undefined): number {
  return owners.get(mesh)?.(triangle ?? -1) ?? -1;
}

/** Whether a cylinder carries a crown straight above it: a trunk. */
function trunk(
  { base, radius }: Readonly<Solid & { kind: "cylinder" | "cone" }>,
  solids: readonly Solid[],
): boolean {
  return solids.some((other) => {
    const above =
      other.kind === "sphere" ? other.centre : other.kind === "cone" ? other.base : null;

    return (
      above !== null && Math.hypot(above[0] - base[0], above[1] - base[1]) <= Math.max(radius, 0.01)
    );
  });
}

/** A crown or a trunk, a chimney or a pole. */
function drawn(obstacle: Solid, solids: readonly Solid[]): Mesh {
  if (obstacle.kind !== "cylinder") {
    const top =
      obstacle.kind === "sphere"
        ? crown(obstacle.radius)
        : conifer(obstacle.radius, obstacle.height);

    top.position.set(...toThree(obstacle.kind === "sphere" ? obstacle.centre : obstacle.base));
    top.name = "solid";

    return top;
  }

  const { base, radius } = obstacle;
  // Drawn its radius short: a carport's post reaches its roof's highest corner over it, and
  // would stand through the roof's slope.
  const height = Math.max(obstacle.height - radius, 0);

  const upright = new Mesh(
    // A trunk tapers toward its crown.
    trunk(obstacle, solids)
      ? new CylinderGeometry(radius * 0.6, radius, height, 14)
      : new CylinderGeometry(radius, radius, height, 16),
    trunk(obstacle, solids) ? finish.trunk() : finish.clay(),
  );

  // three.js centres a cylinder on its position.
  upright.position.set(...toThree([base[0], base[1], base[2] + height / 2]));
  upright.name = "solid";

  return upright;
}

/** A crown or a trunk, a chimney or a pole, named by its obstacle. */
export function solid(obstacle: Solid, solids: readonly Solid[]): Mesh {
  const mesh = drawn(obstacle, solids);

  own(mesh, obstacle.obstacle ?? -1);

  return mesh;
}

/** A marker's body, its back to its wall: it turns with its house (ADR 20). */
export function marker({ at, out }: Mount): Mesh {
  const box = new Mesh(new RoundedBoxGeometry(0.5, 0.6, 0.5, 3, 0.03), finish.equipment());
  const [x, , z] = toThree(out);

  box.position.set(...toThree(at));
  box.rotation.y = Math.atan2(x, z);
  box.name = "equipment";

  return box;
}
