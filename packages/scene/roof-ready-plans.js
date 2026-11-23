// The ready roofs (ADR 20), each as a person traces it: the paths clicked, the lines marked, the
// heights set. `roof-ready.js` makes them. Pure.

/** @import { Kind, ReadyEntry, RoofSize } from "./roof.d.ts" */

/** @typedef {readonly [number, number]} Flat A place seen from above, x and z. */

/**
 * A ready roof as a person makes it: the paths clicked, each joined from click to click; the
 * lines then marked eave or ridge; the points whose heights are then set. The eaves and ridges
 * are pulled to the size's heights last.
 * @typedef {{
 *   readonly paths: readonly (readonly Flat[])[],
 *   readonly marks?: readonly { readonly from: Flat, readonly to: Flat, readonly kind: Kind }[],
 *   readonly heights?: readonly { readonly at: Flat, readonly height: number }[],
 * }} Plan
 */

/** @typedef {ReadyEntry & { readonly plan: (size: RoofSize) => Plan }} ReadyRoof */

/** Metres a step between two roof parts is wide seen from above: a point has one height, so a
 * step is a strip this narrow rising between them. */
const STEP = 0.1;

/** Metres a parapet's top is wide. */
const PARAPET = 0.2;

/** A Sheddach's teeth. */
const TEETH = 3;

/** A Tonnendach's flat strips: a module grid and the yield need one plane per face. */
const STRIPS = 6;

/** @type {(x: number, z: number) => Flat} */
const flat = (x, z) => [x, z];

/**
 * The corners of a rectangle `w` by `d` from the origin, `inset` metres in on every side.
 * @param {number} w
 * @param {number} d
 * @param {number} [inset]
 * @returns {Flat[]}
 */
const corners = (w, d, inset = 0) => [
  flat(inset, inset),
  flat(w - inset, inset),
  flat(w - inset, d - inset),
  flat(inset, d - inset),
];

/**
 * That rectangle clicked round.
 * @param {number} w
 * @param {number} d
 * @param {number} [inset]
 * @returns {Flat[]}
 */
const box = (w, d, inset = 0) => [...corners(w, d, inset), flat(inset, inset)];

/**
 * A line from each corner of the outline to the same corner `inset` metres in.
 * @param {number} w
 * @param {number} d
 * @param {number} inset
 * @returns {Flat[][]}
 */
const mitres = (w, d, inset) => {
  const inner = corners(w, d, inset);

  return corners(w, d).map((c, k) => [c, inner[k] ?? c]);
};

/**
 * A line clicked across the roof along x, `z` metres in.
 * @param {number} w
 * @param {number} z
 * @returns {Flat[]}
 */
const across = (w, z) => [flat(0, z), flat(w, z)];

/**
 * The line across along x, `z` metres in, made `kind`.
 * @param {number} w
 * @param {number} z
 * @param {Kind} kind
 */
const marked = (w, z, kind) => ({ from: flat(0, z), to: flat(w, z), kind });

/**
 * The points at each x of `xs` and each z of `zs`, set to `height`.
 * @param {readonly number[]} xs
 * @param {readonly number[]} zs
 * @param {number} height
 */
const raised = (xs, zs, height) => xs.flatMap((x) => zs.map((z) => ({ at: flat(x, z), height })));

/**
 * A Mansard roof's break: two thirds of the way from its eaves to its top.
 * @param {number} eave
 * @param {number} ridge
 */
const broken = (eave, ridge) => eave + ((ridge - eave) * 2) / 3;

/**
 * The hips and ridge of a hip roof on the rectangle `w` by `d` `inset` metres in, clicked: its
 * ridge along the longer side, a hip from each corner to the nearer end, an apex on a square.
 * @param {number} w
 * @param {number} d
 * @param {number} inset
 * @returns {Flat[][]}
 */
function hipped(w, d, inset) {
  const [x0, z0, x1, z1] = [inset, inset, w - inset, d - inset];
  const half = Math.min(x1 - x0, z1 - z0) / 2;
  const long = x1 - x0 >= z1 - z0;
  const a = long ? flat(x0 + half, (z0 + z1) / 2) : flat((x0 + x1) / 2, z0 + half);
  const b = long ? flat(x1 - half, (z0 + z1) / 2) : flat((x0 + x1) / 2, z1 - half);
  const [n0, n1] = long ? [flat(x0, z0), flat(x0, z1)] : [flat(x0, z0), flat(x1, z0)];
  const [f0, f1] = long ? [flat(x1, z0), flat(x1, z1)] : [flat(x0, z1), flat(x1, z1)];
  const ridge = Math.hypot(a[0] - b[0], a[1] - b[1]) > 0 ? [a, b] : [a];

  // Each line is clicked from one the roof has, as a line touching none starts a block of its own.
  return [
    [n0, ...ridge, f0],
    [n1, a],
    [f1, b],
  ];
}

/** @type {readonly ReadyRoof[]} */
const STEPPED = [
  {
    id: "versetztes-pultdach",
    de: "Versetztes Pultdach",
    en: "Offset mono-pitch roof",
    plan: ({ width: w, depth: d, eave, ridge }) => ({
      paths: [box(w, d), across(w, d / 2), across(w, d / 2 + STEP)],
      heights: raised([0, w], [d / 2 + STEP], broken(eave, ridge)),
    }),
  },
  {
    id: "flachdach",
    de: "Flachdach",
    en: "Flat roof",
    plan: ({ width: w, depth: d }) => ({ paths: [box(w, d)] }),
  },
  {
    id: "flachdach-attika",
    de: "Flachdach mit Attika",
    en: "Flat roof with parapet",
    plan: ({ width: w, depth: d }) => {
      const wall = PARAPET + STEP;

      return {
        paths: [box(w, d), ...mitres(w, d, wall), box(w, d, PARAPET), box(w, d, wall)],
        marks: [
          marked(w, 0, "ridge"),
          marked(w, d, "ridge"),
          { from: flat(wall, wall), to: flat(w - wall, wall), kind: "eave" },
          { from: flat(wall, d - wall), to: flat(w - wall, d - wall), kind: "eave" },
        ],
      };
    },
  },
];

/** @type {readonly ReadyRoof[]} */
const HIPPED = [
  {
    id: "walmdach",
    de: "Walmdach",
    en: "Hip roof",
    plan: ({ width: w, depth: d }) => ({ paths: [box(w, d), ...hipped(w, d, 0)] }),
  },
  {
    id: "krueppelwalmdach",
    de: "Krüppelwalmdach",
    en: "Half-hip roof",
    plan: ({ width: w, depth: d, eave, ridge }) => {
      const hip = Math.min(w, d) / 4;

      return {
        paths: [
          box(w, d),
          [flat(0, d / 4), flat(hip, d / 2), flat(w - hip, d / 2), flat(w, d / 4)],
          [flat(0, (d * 3) / 4), flat(hip, d / 2)],
          [flat(w - hip, d / 2), flat(w, (d * 3) / 4)],
        ],
        // Its hips start halfway up the gable, on the main faces' plane.
        heights: raised([0, w], [d / 4, (d * 3) / 4], (eave + ridge) / 2),
      };
    },
  },
  {
    id: "zeltdach",
    de: "Zeltdach",
    en: "Pyramid roof",
    plan: ({ width: w, depth: d }) => ({
      paths: [box(w, d), ...corners(w, d).map((c) => [c, flat(w / 2, d / 2)])],
    }),
  },
  {
    id: "mansarddach",
    de: "Mansarddach",
    en: "Mansard roof",
    plan: ({ width: w, depth: d, eave, ridge }) => ({
      paths: [box(w, d), across(w, d / 2), across(w, d / 6), across(w, (d * 5) / 6)],
      heights: raised([0, w], [d / 6, (d * 5) / 6], broken(eave, ridge)),
    }),
  },
  {
    id: "mansardwalmdach",
    de: "Mansardwalmdach",
    en: "Mansard hip roof",
    plan: ({ width: w, depth: d, eave, ridge }) => {
      const b = Math.min(w, d) / 6;

      return {
        paths: [box(w, d), ...mitres(w, d, b), box(w, d, b), ...hipped(w, d, b)],
        heights: corners(w, d, b).map((at) => ({ at, height: broken(eave, ridge) })),
      };
    },
  },
];

/** @type {readonly ReadyRoof[]} */
const OTHERS = [
  {
    id: "schleppdach",
    de: "Schleppdach",
    en: "Catslide roof",
    // A gable over the back two thirds, its front face dragged on at half the pitch.
    plan: ({ width: w, depth: d, eave, ridge }) => ({
      paths: [box(w, d), across(w, d / 3), across(w, (d * 2) / 3)],
      heights: raised([0, w], [0, (d * 2) / 3], eave + (ridge - eave) / 3),
    }),
  },
  {
    id: "sheddach",
    de: "Sheddach",
    en: "Sawtooth roof",
    plan: ({ width: w, depth: d }) => {
      const steps = Array.from({ length: TEETH - 1 }, (_, k) => ((k + 1) * d) / TEETH);

      return {
        paths: [box(w, d), ...steps.flatMap((z) => [across(w, z - STEP), across(w, z)])],
        marks: [...steps.map((z) => marked(w, z, "eave")), marked(w, d, "ridge")],
      };
    },
  },
  {
    id: "schmetterlingsdach",
    de: "Schmetterlingsdach",
    en: "Butterfly roof",
    plan: ({ width: w, depth: d }) => ({
      paths: [box(w, d), across(w, d / 2)],
      marks: [marked(w, d / 2, "eave"), marked(w, 0, "ridge"), marked(w, d, "ridge")],
    }),
  },
  {
    id: "tonnendach",
    de: "Tonnendach",
    en: "Barrel roof",
    plan: ({ width: w, depth: d, eave, ridge }) => {
      // The arc through both eaves and the top, its radius from its chord and its rise.
      const rise = ridge - eave;
      const radius = ((d / 2) ** 2 + rise ** 2) / (2 * rise);
      const zs = Array.from({ length: STRIPS - 1 }, (_, k) => ((k + 1) * d) / STRIPS);

      return {
        paths: [box(w, d), ...zs.map((z) => across(w, z))],
        heights: zs
          .filter((z) => z !== d / 2)
          .flatMap((z) =>
            raised([0, w], [z], ridge - radius + Math.sqrt(radius ** 2 - (z - d / 2) ** 2)),
          ),
      };
    },
  },
];

/** The ready roofs, in the order a menu lists them. */
/** @type {readonly ReadyRoof[]} */
export const ROOFS = [
  {
    id: "satteldach",
    de: "Satteldach",
    en: "Gable roof",
    plan: ({ width: w, depth: d }) => ({ paths: [box(w, d), across(w, d / 2)] }),
  },
  {
    id: "pultdach",
    de: "Pultdach",
    en: "Mono-pitch roof",
    plan: ({ width: w, depth: d }) => ({ paths: [box(w, d)], marks: [marked(w, 0, "ridge")] }),
  },
  ...STEPPED,
  ...HIPPED,
  ...OTHERS,
];
