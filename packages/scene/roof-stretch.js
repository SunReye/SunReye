// A ready roof stretched (ADR 20): a traced block whose footprint is a rectangle has a side set to
// a length from the side across from it; every point moves in step along it, its height kept.

/** @typedef {import("./index.d.ts").Block} Block */
/** @typedef {import("./index.d.ts").Scene} Scene */

/** How far off a right angle, as the cosine between two sides, a corner still counts square. */
const SQUARE = 1e-3;

/** @param {number} value */
const tidy = (value) => Math.round(value * 1e6) / 1e6 + 0;

/**
 * Traced block `block`'s footprint as a rectangle: its first corner, the way its first and second
 * sides run (x and z, of length 1) and their lengths; null unless it has four square corners.
 * @param {Block | undefined} block
 * @returns {{ corner: [number, number], axes: [[number, number], [number, number]], lengths: [number, number] } | null}
 */
export function rectangleOf(block) {
  const footprint = block?.freeForm?.footprint;

  if (footprint?.length !== 4) return null;

  /** @param {number} index @returns {[number, number]} */
  const corner = (index) => {
    const point = footprint[index % 4];

    return [point?.[0] ?? 0, point?.[1] ?? 0];
  };

  /** @param {number} index @returns {[number, number]} */
  const side = (index) => {
    const [[x, z], [nx, nz]] = [corner(index), corner(index + 1)];

    return [nx - x, nz - z];
  };

  /** @param {number} index */
  const length = (index) => Math.hypot(...side(index));

  /** @param {number} index Whether the corner after side `index` is square. */
  const square = (index) => {
    const [[x, z], [nx, nz]] = [side(index), side(index + 1)];

    return Math.abs(x * nx + z * nz) <= SQUARE * length(index) * length(index + 1);
  };

  const [u, v] = [length(0), length(1)];

  if (![0, 1, 2, 3].every((index) => square(index)) || u < 1e-6 || v < 1e-6) return null;

  const [[ux, uz], [vx, vz]] = [side(0), side(1)];

  return {
    corner: corner(0),
    axes: [
      [tidy(ux / u), tidy(uz / u)],
      [tidy(vx / v), tidy(vz / v)],
    ],
    lengths: [tidy(u), tidy(v)],
  };
}

/**
 * The scene with traced block `index`'s side `side` (0 its first, 1 its second) set to `length`
 * metres, the side across from it staying; the same scene where the block is no traced rectangle
 * or the length is none.
 * @param {Scene} scene
 * @param {number} index
 * @param {0 | 1} side
 * @param {number} length
 * @returns {Scene}
 */
export function stretchBlock(scene, index, side, length) {
  const block = scene.blocks[index];
  const form = block?.freeForm;
  const rect = rectangleOf(block);

  if (!block || !form || !rect || !(length > 0)) return scene;

  const [[cx, cz], [ax, az], grown] = [rect.corner, rect.axes[side], length / rect.lengths[side]];

  /** @param {number} x @param {number} z @returns {[number, number]} */
  const moved = (x, z) => {
    const by = ((x - cx) * ax + (z - cz) * az) * (grown - 1);

    return [tidy(x + ax * by), tidy(z + az * by)];
  };

  /** @param {readonly (readonly number[])[]} points */
  const upright = (points) =>
    points.map(([x = 0, y = 0, z = 0]) => {
      const [mx, mz] = moved(x, z);

      return [mx, y, mz];
    });

  const freeForm = {
    ...form,
    footprint: form.footprint.map(([x = 0, z = 0]) => moved(x, z)),
    faces: form.faces.map(upright),
    ...(form.traced && { traced: { ...form.traced, points: upright(form.traced.points) } }),
  };

  return { ...scene, blocks: scene.blocks.with(index, { ...block, freeForm }) };
}
