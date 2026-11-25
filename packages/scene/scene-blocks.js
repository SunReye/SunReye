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
