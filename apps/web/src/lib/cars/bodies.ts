// Car bodies as three.js objects (ADR 20): SunReye's own low-poly bodies per class, procedural
// boxes and wheels and no vehicle's design, or an uploaded model fitted to its place.
import {
  Box3,
  BoxGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  Vector3,
  type Object3D,
} from "three";
import type { BodyClass } from "../builder/pv.ts";
import { toThree } from "../builder/scene.ts";
import type { Parked } from "./parked.ts";

/**
 * A class's silhouette: its length as a share of its place's, the height of its bonnet line and
 * its roof in metres, and its cabin's length and offset toward the rear as shares of its own.
 */
interface Silhouette {
  readonly length: number;
  readonly deck: number;
  readonly roof: number;
  readonly cabin: number;
  readonly offset: number;
}

const SILHOUETTES: Readonly<Record<BodyClass, Silhouette>> = {
  sedan: { length: 0.92, deck: 0.75, roof: 1.45, cabin: 0.5, offset: 0.05 },
  hatchback: { length: 0.82, deck: 0.8, roof: 1.5, cabin: 0.6, offset: 0.12 },
  suv: { length: 0.92, deck: 0.95, roof: 1.7, cabin: 0.62, offset: 0.08 },
  van: { length: 0.95, deck: 1, roof: 1.95, cabin: 0.82, offset: 0.08 },
  pickup: { length: 0.98, deck: 1.05, roof: 1.85, cabin: 0.35, offset: -0.15 },
};

/** Metres. */
const WHEEL = 0.33;
const SILL = 0.25;
const WIDEST = 1.95;
const GLASS = 0x2b3440;
const TYRE = 0x1d1f22;

function box(
  size: readonly [number, number, number],
  at: readonly [number, number, number],
  colour: number | string,
): Mesh {
  const mesh = new Mesh(
    new BoxGeometry(...size),
    new MeshStandardMaterial({ color: colour, flatShading: true }),
  );

  mesh.position.set(...at);

  return mesh;
}

function wheel(x: number, z: number): Mesh {
  const mesh = new Mesh(
    new CylinderGeometry(WHEEL, WHEEL, 0.25, 12),
    new MeshStandardMaterial({ color: TYRE, flatShading: true }),
  );

  mesh.rotation.z = Math.PI / 2;
  mesh.position.set(x, WHEEL, z);

  return mesh;
}

/** Turns `object`, whose nose points along its −z, to its stand. */
function stand<T extends Object3D>(object: T, { at, forward: [east, north] }: Parked): T {
  object.position.set(...toThree(at));
  object.rotation.y = Math.atan2(-east, north);
  object.name = "car";

  return object;
}

/** The car's stylised body, in its colour, at its stand. */
export function carBody(car: Parked): Group {
  const silhouette = SILHOUETTES[car.body.class];
  const length = car.length * silhouette.length;
  const width = Math.min(car.width * 0.8, WIDEST);
  const cabin = length * silhouette.cabin;
  const group = new Group();

  group.add(
    box(
      [width, silhouette.deck - SILL, length],
      [0, (silhouette.deck + SILL) / 2, 0],
      car.body.colour,
    ),
    box(
      [width * 0.9, silhouette.roof - silhouette.deck - 0.06, cabin],
      [0, (silhouette.roof + silhouette.deck - 0.06) / 2, length * silhouette.offset],
      GLASS,
    ),
    box(
      [width * 0.9, 0.06, cabin],
      [0, silhouette.roof - 0.03, length * silhouette.offset],
      car.body.colour,
    ),
    ...[-1, 1].flatMap((side) =>
      [-1, 1].map((end) => wheel(side * (width / 2 - 0.1), end * length * 0.33)),
    ),
  );

  return stand(group, car);
}

/** An uploaded model at its stand, fitted to the place's length. */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- three.js adds the model to a group.
export function placedModel(model: Object3D, car: Parked): Group {
  return stand(fitModel(model, car.length), car);
}

/**
 * `model` scaled so its longer horizontal side is `length`, centred over the origin and set on
 * the ground, its front turned from glTF's +z to −z.
 */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- three.js adds the model to a group.
export function fitModel(model: Object3D, length: number): Group {
  const inner = new Group();
  const fitted = new Group();

  const bounds = (): Box3 => {
    inner.updateMatrixWorld(true);

    return new Box3().setFromObject(inner);
  };

  inner.add(model);
  inner.rotation.y = Math.PI;

  const size = bounds().getSize(new Vector3());

  inner.scale.setScalar(length / Math.max(size.x, size.z, Number.EPSILON));

  const bounded = bounds();
  const centre = bounded.getCenter(new Vector3());

  inner.position.set(-centre.x, -bounded.min.y, -centre.z);
  fitted.add(inner);

  return fitted;
}
