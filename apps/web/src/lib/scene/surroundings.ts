// Ground surfaces and fences as the scene draws them (ADR 20 Surroundings): placed by the pv
// crate, drawn only, never shading. And the aerial image the builder's consumer supplies, draped
// on the ground and on the roof faces: each point shows the part of the image straight above it.
// Pure: no DOM.
import {
  BoxGeometry,
  BufferGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  InstancedMesh,
  LinearMipmapLinearFilter,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  SRGBColorSpace,
  Texture,
} from "three";
import type { Face, Fencing, Ground, Point } from "../builder/pv.ts";
import type { Aerial, Extent } from "../builder/supplied.ts";
import { FENCE, GROUND } from "./materials.ts";
import { fan } from "./surfaces.ts";

/** Metres above the floor of the first surface, and between each and the next. */
const LIFT = 0.005;
const STACK = 0.002;

/** East, north, up to three.js: x east, y up, z south. */
const toThree = ([east, north, up]: Point): [number, number, number] => [east, up, 0 - north];

/** A ground surface, lifted over the floor and over every earlier one. */
export function ground({ finish, corners }: Ground, index: number): Mesh {
  const geometry = new BufferGeometry();

  geometry.setAttribute(
    "position",
    new Float32BufferAttribute(
      fan(corners).flatMap((point) => toThree(point)),
      3,
    ),
  );
  geometry.computeVertexNormals();

  const material = GROUND[finish]();

  material.side = DoubleSide;
  material.polygonOffset = true;
  material.polygonOffsetFactor = -1 - index;
  material.polygonOffsetUnits = -1 - index;

  const mesh = new Mesh(geometry, material);

  mesh.position.y = LIFT + index * STACK;
  mesh.name = "ground";

  return mesh;
}

/** Board, bar and wall sizes in metres. */
const BOARD = 0.04;
const WALL = 0.2;
const POST = 0.09;
const RAIL = 0.04;
const BAR = 0.02;
const BARS = 0.12;

/** A box from `from` to `to` on the ground, `thick` across and `high` tall. */
function run(
  from: readonly [number, number, number],
  to: readonly [number, number, number],
  [thick, high, low]: readonly [number, number, number],
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- three.js draws with it.
  material: MeshStandardMaterial,
): Mesh {
  const length = Math.hypot(to[0] - from[0], to[2] - from[2]);
  const mesh = new Mesh(new BoxGeometry(length, high, thick), material);

  mesh.position.set((from[0] + to[0]) / 2, low + high / 2, (from[2] + to[2]) / 2);
  mesh.rotation.y = Math.atan2(-(to[2] - from[2]), to[0] - from[0]);

  return mesh;
}

/** Upright bars of `size` between `from` and `to`, every `every` metres. */
function bars(
  from: readonly [number, number, number],
  to: readonly [number, number, number],
  [size, every, height]: readonly [number, number, number],
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- three.js draws with it.
  material: MeshStandardMaterial,
): InstancedMesh {
  const length = Math.hypot(to[0] - from[0], to[2] - from[2]);
  const count = Math.max(2, Math.round(length / every) + 1);
  const mesh = new InstancedMesh(new BoxGeometry(size, height, size), material, count);
  const matrix = new Matrix4();

  for (let i = 0; i < count; i++) {
    const t = i / (count - 1);

    mesh.setMatrixAt(
      i,
      matrix.makeTranslation(
        from[0] + (to[0] - from[0]) * t,
        height / 2,
        from[2] + (to[2] - from[2]) * t,
      ),
    );
  }

  return mesh;
}

/** One stretch of fence between two points, in its finish. */
function stretch(
  from: readonly [number, number, number],
  to: readonly [number, number, number],
  { finish, height }: Fencing,
): (Mesh | InstancedMesh)[] {
  const material = FENCE[finish]();

  if (finish === "wall") return [run(from, to, [WALL, height, 0], material)];

  if (finish === "wood") {
    return [
      run(from, to, [BOARD, height - 0.05, 0.05], material),
      // A post at each end.
      bars(from, to, [POST, Infinity, height], material),
    ];
  }

  // Rails top and bottom, bars between, posts at the ends.
  return [
    run(from, to, [RAIL, RAIL, height - RAIL], material),
    run(from, to, [RAIL, RAIL, 0.08], material),
    bars(from, to, [BAR, BARS, height - RAIL], material),
    bars(from, to, [POST * 0.7, 2.5, height], material),
  ];
}

/** A fence along its points, every stretch in its finish. */
export function fence(fencing: Fencing): Group {
  const group = new Group();
  const points = fencing.points.map((point) => toThree(point));

  for (const [i, to] of points.entries()) {
    const from = points[i - 1];

    if (from !== undefined) group.add(...stretch(from, to, fencing));
  }

  group.name = "fence";

  return group;
}

/** What the scene draws of what the consumer supplies: the image, and the neighbours as the pv
 * crate's faces. */
export interface Around {
  readonly aerial?: Aerial | undefined;
  readonly neighbours: readonly Face[];
}

/** Metres the aerial image lies over the floor: under every ground surface. */
const UNDER = 0.002;

/** The image last draped and its texture: one at a time, the last freed for the next. */
let draped: { readonly image: TexImageSource; readonly map: Texture } | undefined;

/** The image as a texture, made once for as long as it stays the one given. */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- the image is the DOM's own.
function mapOf({ image }: Aerial): Texture {
  if (draped?.image === image) return draped.map;

  draped?.map.dispose();

  const map = new Texture(image);

  map.colorSpace = SRGBColorSpace;
  // Every source the same way up, an ImageBitmap too, which ignores a flip: the first row is the
  // north edge.
  map.flipY = false;
  map.minFilter = LinearMipmapLinearFilter;
  map.anisotropy = 8;
  map.needsUpdate = true;
  draped = { image, map };

  return map;
}

/** Where a point east, north lies on the image: 0 to 1 from the west edge and from the north. */
function onImage([east, north]: Point, extent: Extent): [number, number] {
  return [
    (east - extent.west) / (extent.east - extent.west),
    (extent.north - north) / (extent.north - extent.south),
  ];
}

/** The image as a matte finish: its colours lit as the clay is. */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- the image is the DOM's own.
export function photo(aerial: Aerial): MeshStandardMaterial {
  return new MeshStandardMaterial({ map: mapOf(aerial), roughness: 0.92, metalness: 0 });
}

/** Sets each vertex's place on the image from where it stands. */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- three.js's mesh, set up in place.
export function drape(mesh: Mesh, extent: Extent): Mesh {
  const position = mesh.geometry.getAttribute("position");
  const uv: number[] = [];

  for (let i = 0; i < position.count; i += 1) {
    // three.js's x east, y up, z south.
    uv.push(...onImage([position.getX(i), 0 - position.getZ(i), position.getY(i)], extent));
  }

  mesh.geometry.setAttribute("uv", new Float32BufferAttribute(uv, 2));

  return mesh;
}

/** The image on the ground over its extent. */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- the image is the DOM's own.
export function aerialGround(aerial: Aerial): Mesh {
  const { west, south, east, north } = aerial.extent;
  const geometry = new BufferGeometry();

  const [nw, sw, se, ne] = [
    [west, UNDER, -north],
    [west, UNDER, -south],
    [east, UNDER, -south],
    [east, UNDER, -north],
  ] as const;

  // Two triangles facing up.
  geometry.setAttribute("position", new Float32BufferAttribute([nw, sw, se, nw, se, ne].flat(), 3));
  geometry.computeVertexNormals();

  const mesh = drape(new Mesh(geometry, photo(aerial)), aerial.extent);

  mesh.name = "aerial";

  return mesh;
}
