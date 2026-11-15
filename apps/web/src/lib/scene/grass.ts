// Ultra's grass (ADR 20 Look, Rendering quality): instanced blades on the lawn near the blocks,
// in the lawn's own colours, thinning out before the plot fades. Drawn only: blades cast no
// shadow and shade nothing.
import {
  BufferAttribute,
  BufferGeometry,
  DoubleSide,
  InstancedMesh,
  Matrix4,
  Mesh,
  type Object3D,
  Vector3,
} from "three";
import { GRASS, LAWN } from "./backdrop.ts";
import { lawn } from "./materials.ts";
import { patched } from "./weather.ts";

/** Metres of ground a cell of the cover grid stands for. */
const CELL = 0.1;

/** How far past the plot's radius blades grow, and the farthest from its centre, in metres. */
const MARGIN = 4;
const FARTHEST = 28;

/** Over the last metres before their edge the blades shrink to nothing: no rim shows. */
const THIN = 4;

/** The most tufts drawn; on a larger plot they stand further apart. */
export const MOST = 70_000;

/** What lies on the ground and keeps the lawn off it, by the name the scene gives its meshes. */
const COVERS: ReadonlySet<string> = new Set(["roof", "flat", "obstacle", "hedge", "ground"]);

/** The ground a scene covers, as a grid over a square about `centre`. */
export class Cover {
  readonly #cells: Uint8Array;
  readonly #side: number;
  readonly #west: number;
  readonly #north: number;

  constructor(centre: readonly [number, number], reach: number) {
    this.#side = Math.ceil((reach * 2) / CELL);
    this.#cells = new Uint8Array(this.#side * this.#side);
    this.#west = centre[0] - reach;
    this.#north = centre[1] - reach;
  }

  /** Covers the triangle `a`, `b`, `c`, each a point on the ground: x and z. */
  add(
    a: readonly [number, number],
    b: readonly [number, number],
    c: readonly [number, number],
  ): void {
    const area = edge(a, b, c);

    if (area === 0) return;

    const [x0, x1] = this.#span(a[0] - this.#west, b[0] - this.#west, c[0] - this.#west);
    const [z0, z1] = this.#span(a[1] - this.#north, b[1] - this.#north, c[1] - this.#north);

    for (let j = z0; j <= z1; j++)
      for (let i = x0; i <= x1; i++) {
        const at = [this.#west + (i + 0.5) * CELL, this.#north + (j + 0.5) * CELL] as const;

        if (inside(a, b, c, at, area)) this.#cells[j * this.#side + i] = 1;
      }
  }

  /** Whether something lies on the ground at `x`, `z`; off the grid nothing is known to. */
  covered(x: number, z: number): boolean {
    const [i, j] = [Math.floor((x - this.#west) / CELL), Math.floor((z - this.#north) / CELL)];

    return i >= 0 && j >= 0 && i < this.#side && j < this.#side
      ? this.#cells[j * this.#side + i] === 1
      : false;
  }

  /** The cells from the least to the greatest of three offsets, inside the grid. */
  #span(p: number, q: number, r: number): readonly [number, number] {
    return [
      Math.max(0, Math.floor(Math.min(p, q, r) / CELL)),
      Math.min(this.#side - 1, Math.floor(Math.max(p, q, r) / CELL)),
    ];
  }
}

type Flat = readonly [number, number];

/** Twice the signed area of `a`, `b`, `p`. */
function edge(a: Flat, b: Flat, p: Flat): number {
  return (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
}

/** Whether `p` lies in the triangle, whichever way it winds. */
function inside(a: Flat, b: Flat, c: Flat, p: Flat, area: number): boolean {
  const sign = Math.sign(area);

  return edge(a, b, p) * sign >= 0 && edge(b, c, p) * sign >= 0 && edge(c, a, p) * sign >= 0;
}

/** Whether a mesh keeps the lawn off the ground under it: a lawn surface is lawn. */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- three.js's part, read only.
function covers(part: Object3D): part is Mesh {
  return (
    part instanceof Mesh &&
    !(part instanceof InstancedMesh) &&
    COVERS.has(part.name) &&
    part.userData["finish"] !== "lawn"
  );
}

/** The ground `root` covers within `reach` of `centre`: its roofs, obstacles, hedges and laid
 * surfaces, each triangle seen from above. */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- three.js's scene, read only.
export function coverOf(root: Object3D, centre: Flat, reach: number): Cover {
  const cover = new Cover(centre, reach);
  const corner = new Vector3();

  root.updateMatrixWorld(true);
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- three.js's part.
  root.traverse((part) => {
    if (!covers(part)) return;

    const position = part.geometry.getAttribute("position");
    const index = part.geometry.getIndex();
    const count = index?.count ?? position.count;

    const at = (i: number): Flat => {
      corner.fromBufferAttribute(position, index?.getX(i) ?? i).applyMatrix4(part.matrixWorld);

      return [corner.x, corner.z];
    };

    for (let i = 0; i + 2 < count; i += 3) cover.add(at(i), at(i + 1), at(i + 2));
  });

  return cover;
}

/** One tuft: where it roots, how tall it stands and how it is turned. */
export interface Tuft {
  readonly x: number;
  readonly z: number;
  readonly height: number;
  readonly turn: number;
}

/** Lehmer's generator: the same lawn on every build. */
function seeded(seed: number): () => number {
  let state = seed;

  return () => (state = (state * 16_807) % 2_147_483_647) / 2_147_483_647;
}

/** How far blades grow from the centre of a plot of `radius`. */
export const reachOf = (radius: number): number => Math.min(radius + MARGIN, FARTHEST);

/**
 * Tufts on the open lawn within `reach` of `centre`, on a jittered grid no denser than `MOST`
 * allows, shrinking to nothing over the last metres.
 */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- only asked.
export function tufts(cover: Cover, centre: Flat, reach: number): Tuft[] {
  const step = Math.max(0.11, Math.sqrt((Math.PI * reach * reach) / MOST));
  const random = seeded(977);
  const found: Tuft[] = [];

  for (let z = -reach; z < reach; z += step)
    for (let x = -reach; x < reach; x += step) {
      const at = [centre[0] + x + random() * step, centre[1] + z + random() * step] as const;
      const [size, turn] = [0.7 + random() * 0.6, random() * Math.PI * 2];
      const far = Math.hypot(at[0] - centre[0], at[1] - centre[1]);
      const thinned = Math.min(1, (reach - far) / THIN);

      if (thinned > 0.15 && !cover.covered(at[0], at[1])) {
        found.push({ x: at[0], z: at[1], height: 0.09 * size * thinned, turn });
      }
    }

  return found;
}

/** A blade's half-width at its root, and how far its tip leans out, in tuft heights. */
const HALF = 0.22;
const LEAN = 0.45;

/** A tuft's three blades, a unit tall: each tapers to its tip and leans out from the middle,
 * dark at the root and bright at the tip. Their normals point up, so they take the lawn's light. */
function tuft(): BufferGeometry {
  const [positions, colours, normals]: number[][] = [[], [], []];

  for (let blade = 0; blade < 3; blade++) {
    const turn = (blade * Math.PI * 2) / 3 + 0.4;

    const [across, out] = [
      [Math.cos(turn), Math.sin(turn)],
      [-Math.sin(turn), Math.cos(turn)],
    ] as const;

    /** A point of the blade: `side` across it, `up` it, leaning out as it rises. */
    const point = (side: number, up: number): void => {
      const lean = 0.25 + up * up * LEAN;

      positions?.push(across[0] * side + out[0] * lean, up, across[1] * side + out[1] * lean);
      colours?.push(0.55 + up * 0.6, 0.55 + up * 0.65, 0.55 + up * 0.5);
      normals?.push(out[0] * 0.25, 1, out[1] * 0.25);
    };

    for (const [side, up] of [
      [-HALF, 0],
      [HALF, 0],
      [HALF * 0.6, 0.55],
      [-HALF, 0],
      [HALF * 0.6, 0.55],
      [-HALF * 0.6, 0.55],
      [-HALF * 0.6, 0.55],
      [HALF * 0.6, 0.55],
      [0, 1],
    ] as const) {
      point(side, up);
    }
  }

  const geometry = new BufferGeometry();

  geometry.setAttribute("position", new BufferAttribute(new Float32Array(positions ?? []), 3));
  geometry.setAttribute("color", new BufferAttribute(new Float32Array(colours ?? []), 3));
  geometry.setAttribute("normal", new BufferAttribute(new Float32Array(normals ?? []), 3));

  return geometry;
}

/** The lawn's finish for blades: each takes the lawn's colour, and its weathering, at its root. */
function finish() {
  const material = lawn();

  material.normalMap = null;
  material.vertexColors = true;
  material.side = DoubleSide;

  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- three.js patches it in place.
  return patched(material, "blade", (shader) => {
    const weathers = shader.vertexShader.includes("vWeatherAt");

    shader.vertexShader = shader.vertexShader.replace(
      "#include <fog_vertex>",
      `#include <fog_vertex>
vec4 bladeRoot = modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
vMapUv = vec2(bladeRoot.x + ${(LAWN / 2).toFixed(1)}, ${(LAWN / 2).toFixed(1)} - bladeRoot.z) / ${GRASS.toFixed(1)};
${weathers ? "vWeatherAt = bladeRoot.xyz;" : ""}`,
    );
  });
}

/**
 * Blades for the lawn `root` leaves open, about `centre` on the ground for a plot of `radius`
 * metres; null where there is no open lawn.
 */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- three.js's scene, read only.
export function blades(root: Object3D, centre: Flat, radius: number): InstancedMesh | null {
  const reach = reachOf(radius);
  const rooted = tufts(coverOf(root, centre, reach), centre, reach);

  if (rooted.length === 0) return null;

  const mesh = new InstancedMesh(tuft(), finish(), rooted.length);
  const [matrix, turned] = [new Matrix4(), new Matrix4()];

  for (const [i, { x, z, height, turn }] of rooted.entries()) {
    matrix.makeScale(height, height, height).premultiply(turned.makeRotationY(turn));
    mesh.setMatrixAt(i, matrix.setPosition(x, 0, z));
  }

  mesh.name = "grass";
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;

  return mesh;
}
