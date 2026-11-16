// The imported ground (ADR 20 Look): the terrain in the lawn's finish, with roads, paths, water
// and land use each drawn in its own generated material through a mask on the same terrain, so
// every finish lies exactly on it. Pure.
import {
  BufferAttribute,
  BufferGeometry,
  DataTexture,
  DoubleSide,
  Float32BufferAttribute,
  LinearFilter,
  type Material,
  Mesh,
  MeshStandardMaterial,
  RedFormat,
  UnsignedByteType,
} from "three";
import type { Around, Draped, PatchFinish, Relief } from "../builder/imported.ts";
import type { Point } from "../builder/pv.ts";
import { reach, toThree } from "./around-fade.ts";
import * as finish from "./materials.ts";
import { paint, soften, stroke, type Spot } from "./mask.ts";
import { patched } from "./weather.ts";

/** Draws a ground finish only where its mask is painted. */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- three.js's own objects.
function masked<M extends Material>(material: M, mask: DataTexture): M {
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- three.js patches it in place.
  return patched(material, "around-mask", (shader) => {
    shader.uniforms["uAroundMask"] = { value: mask };
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        "#include <common>\nattribute vec2 grid;\nvarying vec2 vAroundGrid;",
      )
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvAroundGrid = grid;");
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        "#include <common>\nvarying vec2 vAroundGrid;\nuniform sampler2D uAroundMask;",
      )
      .replace(
        "#include <clipping_planes_fragment>",
        "#include <clipping_planes_fragment>\nfloat aroundMask = smoothstep(0.4, 0.6, texture2D(uAroundMask, vAroundGrid).r);\nif (aroundMask < 0.004) discard;",
      )
      .replace(
        "#include <alphatest_fragment>",
        "#include <alphatest_fragment>\ndiffuseColor.a *= aroundMask;",
      );
  });
}

/** The lawn's map turned toward a colour, as a factor per channel. */
function toned(tone: readonly [number, number, number]): MeshStandardMaterial {
  const material = finish.lawn();

  material.color.setRGB(...tone);

  return material;
}

/** Each imported finish in a generated material, and the metres one repeat of its map covers. */
const FINISHES: Readonly<
  Record<PatchFinish, readonly [() => MeshStandardMaterial, readonly [number, number]]>
> = {
  // Stubble and dry soil; a park's lawn; a wood's dark floor.
  field: [() => toned([1.5, 1.2, 0.6]), finish.REPEAT.lawn],
  grass: [() => toned([1.06, 1.1, 0.92]), finish.REPEAT.lawn],
  wood: [() => toned([0.5, 0.68, 0.46]), finish.REPEAT.lawn],
  water: [() => new MeshStandardMaterial({ color: 0x35607a, roughness: 0.12 }), finish.REPEAT.lawn],
  path: [finish.GROUND.gravel, finish.REPEAT.gravel],
  road: [finish.GROUND.driveway, finish.REPEAT.driveway],
};

/** The order the finishes are drawn in, each over the last. */
const ORDER: readonly PatchFinish[] = ["field", "grass", "wood", "water", "path", "road"];

/** Metres a mask's pixel covers at most; its side is a power of two up to `LARGEST`. */
const PIXEL = 0.2;
const LARGEST = 2048;

function maskSide(metres: number): number {
  return Math.min(LARGEST, 2 ** Math.ceil(Math.log2(Math.max(metres / PIXEL, 64))));
}

/** A spot east and north of the scene's origin, in nodes across and along the relief. */
function inGrid({ origin, across, along }: Relief): (point: Point) => Spot {
  const step = across[0] * across[0] + across[1] * across[1] || 1;

  return ([east, north]) => {
    const [dx, dy] = [east - origin[0], north - origin[1]];

    return [(dx * across[0] + dy * across[1]) / step, (dx * along[0] + dy * along[1]) / step];
  };
}

/** Where each finish lies on the relief: a byte per pixel, 255 inside; none for one not there. */
export function masks(
  relief: Relief,
  grounds: readonly Draped[],
): Map<PatchFinish, { readonly data: Uint8Array; readonly side: number }> {
  const metres = reach(relief)[2] * 2;
  const side = maskSide(metres);
  const scale = side / Math.max(relief.side - 1, 1);
  const node = inGrid(relief);
  const found = new Map<PatchFinish, { readonly data: Uint8Array; readonly side: number }>();

  for (const { finish: kind, width, points } of grounds) {
    const mask = found.get(kind) ?? { data: new Uint8Array(side * side), side };

    const spots = points.map((point): Spot => {
      const [u, v] = node(point);

      return [u * scale, v * scale];
    });

    const outlines =
      width === undefined || width === null ? [spots] : stroke(spots, (width / metres) * side);

    for (const outline of outlines) paint(mask.data, side, outline);

    found.set(kind, mask);
  }

  for (const mask of found.values()) soften(mask.data, side);

  return found;
}

/** The masks last painted, by what they were painted for: a move or a turn of the import leaves
 * them as they are, since they lie in the relief's own grid. */
let painted: { readonly key: string; readonly textures: Map<PatchFinish, DataTexture> } | undefined;

function maskTextures(key: string, around: Around): Map<PatchFinish, DataTexture> {
  if (painted?.key === key) return painted.textures;

  for (const texture of painted?.textures.values() ?? []) texture.dispose();

  const textures = new Map<PatchFinish, DataTexture>();

  for (const [kind, { data, side }] of masks(around.terrain, around.grounds)) {
    const texture = new DataTexture(data, side, side, RedFormat, UnsignedByteType);

    texture.magFilter = texture.minFilter = LinearFilter;
    texture.needsUpdate = true;
    textures.set(kind, texture);
  }

  painted = { key, textures };

  return textures;
}

/** The relief's nodes as one mesh's geometry, without texture coordinates. */
function ground(relief: Relief): BufferGeometry {
  const { origin, across, along, side, heights } = relief;
  const positions: number[] = [];
  const grid: number[] = [];
  const index: number[] = [];
  const last = Math.max(side - 1, 1);

  for (let row = 0; row < side; row++) {
    for (let column = 0; column < side; column++) {
      positions.push(
        ...toThree([
          origin[0] + column * across[0] + row * along[0],
          origin[1] + column * across[1] + row * along[1],
          heights[row * side + column] ?? 0,
        ]),
      );
      grid.push(column / last, row / last);

      if (row + 1 < side && column + 1 < side) {
        const at = row * side + column;

        index.push(at, at + 1, at + side + 1, at, at + side + 1, at + side);
      }
    }
  }

  const geometry = new BufferGeometry();

  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setAttribute("grid", new Float32BufferAttribute(grid, 2));
  geometry.setIndex(index);
  geometry.computeVertexNormals();

  return geometry;
}

/** The same nodes with a finish's texture coordinates: its map repeats every `repeat` metres. */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- three.js's own objects.
function clothed(nodes: BufferGeometry, [across, up]: readonly [number, number]): BufferGeometry {
  const geometry = new BufferGeometry();
  const position = nodes.getAttribute("position");
  const uv = new Float32Array(position.count * 2);

  for (let i = 0; i < position.count; i++) {
    uv[i * 2] = position.getX(i) / across;
    uv[i * 2 + 1] = (0 - position.getZ(i)) / up;
  }

  for (const name of ["position", "normal", "grid"]) {
    geometry.setAttribute(name, nodes.getAttribute(name));
  }

  geometry.setAttribute("uv", new BufferAttribute(uv, 2));
  geometry.setIndex(nodes.getIndex());

  return geometry;
}

/** The terrain in the lawn's finish, and each finish that lies on it drawn through its mask.
 * Behind the scene's own ground surfaces, which lie on the level ground by the blocks. */
export function terrain(around: Around, key: string): Mesh[] {
  const nodes = ground(around.terrain);
  const textures = maskTextures(key, around);

  const layer = (
    name: string,
    // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- set up, then drawn.
    material: MeshStandardMaterial,
    repeat: readonly [number, number],
    order: number,
  ): Mesh => {
    material.side = DoubleSide;
    material.polygonOffset = true;
    material.polygonOffsetFactor = material.polygonOffsetUnits = ORDER.length + 1 - order;

    const mesh = new Mesh(clothed(nodes, repeat), material);

    mesh.name = name;
    mesh.renderOrder = order - ORDER.length - 1;
    mesh.receiveShadow = true;

    return mesh;
  };

  return [
    layer("terrain", finish.lawn(), finish.REPEAT.lawn, 0),
    ...ORDER.flatMap((kind, i) => {
      const mask = textures.get(kind);
      const [make, repeat] = FINISHES[kind];

      return mask === undefined ? [] : [layer("ground", masked(make(), mask), repeat, i + 1)];
    }),
  ];
}
