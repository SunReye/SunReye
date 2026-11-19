// The handles as three.js objects (ADR 20): arrows on the walls, a knob on the ridge and on each
// fence point, a ring on the ground and the footprint's outline, drawn over the scene in the brand colour. Each handle
// carries a larger, unseen hit body so a finger finds it.
/* oxlint-disable typescript/prefer-readonly-parameter-types -- three.js objects, built in place. */
import {
  BufferAttribute,
  BufferGeometry,
  type Color,
  ConeGeometry,
  CylinderGeometry,
  Group,
  LineBasicMaterial,
  LineLoop,
  type Material,
  Mesh,
  MeshBasicMaterial,
  type Object3D,
  Quaternion,
  Raycaster,
  SphereGeometry,
  TorusGeometry,
  Vector2,
  Vector3,
  type Camera,
} from "three";
import type { Handle } from "./grips.ts";

/** Metres: big enough to read on a house, small enough not to hide its walls. */
const CONE = { radius: 0.22, length: 0.5 };
const SHAFT = { radius: 0.06, length: 0.45 };
const KNOB = 0.24;
const TUBE = 0.06;

/** A fingertip's reach around each handle, in metres. */
const REACH = 0.6;
const RING_REACH = 0.35;

/** Over everything the scene draws. */
const ON_TOP = 10;

const UP = new Vector3(0, 1, 0);

/** Each handle's group, by its handle. */
const HANDLES = new WeakMap<Object3D, Handle>();

function seen(colour: Color): MeshBasicMaterial {
  return new MeshBasicMaterial({
    color: colour,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });
}

/** Drawn into nothing, hit by the ray. */
function unseen(): MeshBasicMaterial {
  return new MeshBasicMaterial({
    transparent: true,
    opacity: 0,
    colorWrite: false,
    depthTest: false,
    depthWrite: false,
  });
}

function arrow(handle: Handle, colour: Color): Object3D[] {
  const tip = new Mesh(new ConeGeometry(CONE.radius, CONE.length, 20), seen(colour));

  const shaft = new Mesh(
    new CylinderGeometry(SHAFT.radius, SHAFT.radius, SHAFT.length, 12),
    seen(colour),
  );

  // Both stand along y, centred: the shaft behind the tip.
  tip.position.y = SHAFT.length / 2 + CONE.length / 2;

  const part = new Group();

  part.add(shaft, tip);
  part.quaternion.copy(
    new Quaternion().setFromUnitVectors(UP, new Vector3(...(handle.axis ?? [1, 0, 0])).normalize()),
  );

  return [part, new Mesh(new SphereGeometry(REACH, 12, 8), unseen())];
}

function ring(handle: Handle, colour: Color): Object3D[] {
  const radius = handle.radius ?? 1;

  const flat = (tube: number, material: Material): Mesh => {
    const torus = new Mesh(new TorusGeometry(radius, tube, 8, 96), material);

    torus.rotation.x = Math.PI / 2;

    return torus;
  };

  return [flat(TUBE, seen(colour)), flat(RING_REACH, unseen())];
}

function outline(handle: Handle, colour: Color): Object3D[] {
  // Just over what it lies on: the ground, or a chimney's roof.
  const points = (handle.outline ?? []).map(([x, y, z]) => new Vector3(x, y + 0.03, z));

  return [
    new LineLoop(
      new BufferGeometry().setFromPoints(points),
      new LineBasicMaterial({
        color: colour,
        transparent: true,
        depthTest: false,
        depthWrite: false,
        toneMapped: false,
      }),
    ),
  ];
}

/** A block's knob: a ball with an arrowhead to each side along the ground, the sign for moving. */
function cross(colour: Color): Object3D[] {
  const heads = [0, 1, 2, 3].map((quarter) => {
    const head = new Mesh(new ConeGeometry(CONE.radius, CONE.length, 16), seen(colour));
    const angle = (quarter * Math.PI) / 2;
    const out = new Vector3(Math.cos(angle), 0, Math.sin(angle));

    head.position.copy(out).multiplyScalar(KNOB + CONE.length / 2);
    head.quaternion.setFromUnitVectors(UP, out);

    return head;
  });

  return [
    new Mesh(new SphereGeometry(KNOB * 0.6, 16, 12), seen(colour)),
    ...heads,
    new Mesh(new SphereGeometry(REACH, 12, 8), unseen()),
  ];
}

function parts(handle: Handle, colour: Color): Object3D[] {
  if (handle.grip === "turn") return ring(handle, colour);

  if (handle.grip === "move") return outline(handle, colour);

  if (handle.axis !== undefined) return arrow(handle, colour);

  if (handle.grip === "carry") return cross(colour);

  return [
    new Mesh(new SphereGeometry(KNOB, 20, 14), seen(colour)),
    new Mesh(new SphereGeometry(REACH, 12, 8), unseen()),
  ];
}

/** One group per handle, at its place; its meshes name their grip. The outline is not hit: the
 * object itself is dragged. */
export function gizmo(found: readonly Handle[], colour: Color): Group {
  const all = new Group();

  for (const handle of found) {
    const group = new Group();
    const [x, y, z] = handle.grip === "move" ? [0, 0, 0] : handle.at;

    group.position.set(x, y, z);
    group.add(...parts(handle, colour));
    HANDLES.set(group, handle);
    group.traverse((part) => {
      part.renderOrder = ON_TOP;
    });
    all.add(group);
  }

  return all;
}

/** Half a fingertip, in canvas pixels: every handle is at least 44 px across (ADR 20). */
const TOUCH = 22;

/** How far a handle's drawn parts come to `at` on `canvas`, in pixels. */
function reach(
  group: Object3D,
  camera: Camera,
  at: readonly [number, number],
  canvas: Readonly<Pick<HTMLCanvasElement, "clientWidth" | "clientHeight">>,
): number {
  const point = new Vector3();
  let nearest = Infinity;

  group.traverse((part) => {
    const material: unknown = part instanceof Mesh ? part.material : undefined;

    if (
      !(part instanceof Mesh) ||
      !(material instanceof MeshBasicMaterial) ||
      !material.colorWrite
    ) {
      return;
    }

    const geometry: unknown = part.geometry;

    if (!(geometry instanceof BufferGeometry)) return;

    const position: unknown = geometry.getAttribute("position");

    if (!(position instanceof BufferAttribute)) return;

    for (let i = 0; i < position.count; i++) {
      point.fromBufferAttribute(position, i).applyMatrix4(part.matrixWorld).project(camera);

      const across = ((point.x - at[0]) * canvas.clientWidth) / 2;
      const down = ((point.y - at[1]) * canvas.clientHeight) / 2;

      nearest = Math.min(nearest, Math.hypot(across, down));
    }
  });

  return nearest;
}

/** The handle the ray from `camera` through `at` (−1 to 1, y up) strikes; else the nearest drawn
 * within half a fingertip on `canvas`; null for none. */
export function handleOf(
  handles: Group,
  camera: Camera,
  at: readonly [number, number],
  canvas: Readonly<Pick<HTMLCanvasElement, "clientWidth" | "clientHeight">>,
): Handle | null {
  const ray = new Raycaster();

  ray.setFromCamera(new Vector2(...at), camera);

  const meshes = handles.children.filter((group) => HANDLES.get(group)?.grip !== "move");
  const [first] = ray.intersectObjects(meshes, true);
  let part = first?.object ?? null;

  while (part !== null && part.parent !== handles) part = part.parent;

  if (part !== null) return HANDLES.get(part) ?? null;

  const near = meshes
    .map((group) => ({ group, pixels: reach(group, camera, at, canvas) }))
    .filter(({ pixels }) => pixels <= TOUCH)
    .toSorted((a, b) => a.pixels - b.pixels)[0];

  return (near && HANDLES.get(near.group)) ?? null;
}

/** Shows the handles `shown` of the way in, 0 to 1: they grow and fade in from the entrance. */
export function appear(handles: Group, shown: number): void {
  for (const group of handles.children) {
    group.scale.setScalar(HANDLES.get(group)?.grip === "move" ? 1 : 0.6 + 0.4 * shown);
    group.traverse((part) => {
      const material: unknown =
        part instanceof Mesh || part instanceof LineLoop ? part.material : undefined;

      const drawn = material instanceof MeshBasicMaterial || material instanceof LineBasicMaterial;

      // The hit bodies stay unseen.
      if (drawn && material.colorWrite) material.opacity = shown;
    });
  }
}

/** Frees the handles' meshes. */
export function free(handles: Group): void {
  handles.traverse((part) => {
    const drawn = part instanceof Mesh || part instanceof LineLoop;
    const geometry: unknown = drawn ? part.geometry : undefined;
    const material: unknown = drawn ? part.material : undefined;

    if (geometry instanceof BufferGeometry) geometry.dispose();

    if (material instanceof MeshBasicMaterial || material instanceof LineBasicMaterial) {
      material.dispose();
    }
  });
}
