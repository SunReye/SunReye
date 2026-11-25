// A block moved or removed with what stands on it (ADR 20). Chimneys, roof windows, existing PV and
// module grids are placed in their roof face, openings and markers on their wall: a moved block
// carries them, and a removed one takes them.

/**
 * @param {readonly (readonly number[])[]} points
 * @param {readonly number[]} by x and z.
 * @param {boolean} upright Each point is x, y and z, not x and z.
 * @returns {number[][]}
 */
const shifted = (points, [dx = 0, dz = 0], upright) =>
  points.map((point) =>
    upright
      ? [(point[0] ?? 0) + dx, point[1] ?? 0, (point[2] ?? 0) + dz]
      : [(point[0] ?? 0) + dx, (point[1] ?? 0) + dz],
  );

/**
 * The scene with block `index` moved `by` metres east (x) and south (z); the same scene for no
 * such block.
 * @param {import("./index.d.ts").Scene} scene
 * @param {number} index
 * @param {readonly number[]} by
 * @returns {import("./index.d.ts").Scene}
 */
export function moveBlock(scene, index, by) {
  const block = scene.blocks[index];

  if (block === undefined) return scene;

  const [dx = 0, dz = 0] = by;
  const form = block.freeForm;

  const freeForm = form && {
    ...form,
    footprint: shifted(form.footprint, by, false),
    faces: form.faces.map((face) => shifted(face, by, true)),
    ...(form.traced && {
      traced: { ...form.traced, points: shifted(form.traced.points, by, true) },
    }),
  };

  const moved = { ...block, x: block.x + dx, z: block.z + dz, ...(freeForm && { freeForm }) };

  return { ...scene, blocks: scene.blocks.with(index, moved) };
}

/** Float noise off a result: never further than a micrometre, never −0. */
const tidy = (value) => Math.round(value * 1e6) / 1e6 + 0;

/**
 * `[x, z]` turned `by` degrees about `[cx, cz]`, clockwise seen from above (x east, z south), as
 * the `pv` crate turns a block.
 * @param {readonly number[]} centre
 * @param {number} by
 * @returns {(x: number, z: number) => [number, number]}
 */
function about([cx = 0, cz = 0], by) {
  const [sin, cos] = [Math.sin((by * Math.PI) / 180), Math.cos((by * Math.PI) / 180)];

  return (x, z) => [
    tidy(cx + (x - cx) * cos - (z - cz) * sin),
    tidy(cz + (x - cx) * sin + (z - cz) * cos),
  ];
}

/**
 * A footprint's centroid, which a turn about it keeps: a turn and its undoing land where they
 * started. Its corners' mean where it encloses nothing.
 * @param {readonly (readonly number[])[]} footprint
 * @returns {[number, number]}
 */
export function centroidOf(footprint) {
  let [area, x, z] = [0, 0, 0];

  for (const [index, [x1 = 0, z1 = 0]] of footprint.entries()) {
    const [x2 = 0, z2 = 0] = footprint[(index + 1) % footprint.length] ?? [];
    const cross = x1 * z2 - x2 * z1;

    area += cross / 2;
    x += ((x1 + x2) * cross) / 6;
    z += ((z1 + z2) * cross) / 6;
  }

  if (Math.abs(area) > 1e-9) return [x / area, z / area];

  const count = footprint.length || 1;

  /** @param {number} axis */
  const mean = (axis) => footprint.reduce((sum, point) => sum + (point[axis] ?? 0), 0) / count;

  return [mean(0), mean(1)];
}

/**
 * @param {readonly (readonly number[])[]} points
 * @param {(x: number, z: number) => [number, number]} spin
 * @param {boolean} upright Each point is x, y and z, not x and z.
 * @returns {number[][]}
 */
const spun = (points, spin, upright) =>
  points.map((point) => {
    const [x, z] = spin(point[0] ?? 0, point[upright ? 2 : 1] ?? 0);

    return upright ? [x, point[1] ?? 0, z] : [x, z];
  });

/**
 * The scene with block `index` turned `by` degrees clockwise seen from above, about its footprint's
 * centroid; what stands on its roof is placed in its faces and turns with it. A traced block
 * keeps its turn so far as its rotation. The same scene for no such block.
 * @param {import("./index.d.ts").Scene} scene
 * @param {number} index
 * @param {number} by
 * @returns {import("./index.d.ts").Scene}
 */
export function turnBlock(scene, index, by) {
  const block = scene.blocks[index];

  if (block === undefined) return scene;

  const rotation = tidy((((block.rotation + by) % 360) + 360) % 360);
  const form = block.freeForm;

  if (form) {
    const centre = centroidOf(form.footprint);
    const spin = about(centre, by);

    const freeForm = {
      ...form,
      footprint: spun(form.footprint, spin, false),
      faces: form.faces.map((face) => spun(face, spin, true)),
      ...(form.traced && {
        traced: {
          ...form.traced,
          points: spun(form.traced.points, spin, true),
        },
      }),
    };

    return {
      ...scene,
      blocks: scene.blocks.with(index, { ...block, rotation, freeForm }),
    };
  }

  // The corner swings about the footprint's centre, which stays.
  const corner = about([0, 0], block.rotation)(block.width / 2, block.depth / 2);
  const centre = [block.x + corner[0], block.z + corner[1]];
  const [x, z] = about([0, 0], rotation)(block.width / 2, block.depth / 2);

  const turned = {
    ...block,
    rotation,
    x: tidy(centre[0] - x),
    z: tidy(centre[1] - z),
  };

  return { ...scene, blocks: scene.blocks.with(index, turned) };
}

/**
 * `item`, named by its block, as it stands once block `index` is gone.
 * @template {{ readonly block: number }} T
 * @param {T} item
 * @param {number} index
 * @returns {T}
 */
const lowered = (item, index) => (item.block > index ? { ...item, block: item.block - 1 } : item);

/**
 * `items` without those on block `index`, later blocks' lowered.
 * @template {{ readonly block: number }} T
 * @param {readonly T[]} items
 * @param {number} index
 * @returns {T[]}
 */
const off = (items, index) =>
  items.filter((item) => item.block !== index).map((item) => lowered(item, index));

/**
 * The scene without block `index` and what stands on it; later blocks' follow them down. The last
 * block may go. The same scene for no such block.
 * @param {import("./index.d.ts").Scene} scene
 * @param {number} index
 * @returns {import("./index.d.ts").Scene}
 */
export function removeBlock(scene, index) {
  if (scene.blocks[index] === undefined) return scene;

  const { chimneys, roofWindows, existingPv, equipment, openings, grids, faceDetails } = scene;

  return {
    ...scene,
    blocks: scene.blocks.toSpliced(index, 1),
    ...(chimneys && { chimneys: off(chimneys, index) }),
    ...(roofWindows && { roofWindows: off(roofWindows, index) }),
    ...(existingPv && { existingPv: off(existingPv, index) }),
    ...(equipment && { equipment: off(equipment, index) }),
    ...(openings && { openings: off(openings, index) }),
    ...(grids && { grids: off(grids, index) }),
    ...(faceDetails && { faceDetails: off(faceDetails, index) }),
  };
}
