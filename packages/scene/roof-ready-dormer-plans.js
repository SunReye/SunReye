// The ready dormers (ADR 20), each as a person traces it on its face: the paths clicked, the lines
// marked, the points set, its own eaves and ridges pulled. `roof-ready-dormer.js` places them. Pure.

/** @import { Kind, ReadyEntry } from "./roof.d.ts" */
/** @import { Flat } from "./roof-ready-plans.js" */

/**
 * A ready dormer's measures on its face, across its slope (u, 0 at its middle) and up it (v, 0 at
 * its front): its width, its depth, where its eaves meet the face, and its heights.
 * @typedef {{
 *   readonly width: number,
 *   readonly depth: number,
 *   readonly meet: number,
 *   readonly eave: number,
 *   readonly top: number,
 * }} Measures
 */

/**
 * A ready dormer as a person makes it, across and up its face: the paths clicked, the lines then
 * marked, the points then set, and its own eaves' and ridges' pulls.
 * @typedef {{
 *   readonly paths: readonly (readonly Flat[])[],
 *   readonly marks?: readonly { readonly from: Flat, readonly to: Flat, readonly kind: Kind }[],
 *   readonly heights?: readonly { readonly at: Flat, readonly height: number }[],
 *   readonly pulls?: readonly { readonly kind: Kind, readonly height: number }[],
 * }} DormerPlan
 */

/**
 * @typedef {ReadyEntry & {
 *   readonly plan: (measures: Measures) => DormerPlan,
 *   readonly eave: boolean,
 *   readonly onEave?: true,
 * }} ReadyDormer
 */

/** @type {(u: number, v: number) => Flat} */
const flat = (u, v) => [u, v];

/** @type {(measures: Measures) => DormerPlan} */
const rectangle = ({ width, depth, eave }) => {
  const [l, r] = [-width / 2, width / 2];

  return {
    paths: [[flat(l, 0), flat(r, 0), flat(r, depth), flat(l, depth), flat(l, 0)]],
    pulls: [{ kind: "eave", height: eave }],
  };
};

/** @type {readonly ReadyDormer[]} */
export const DORMERS = [
  { id: "schleppgaube", de: "Schleppgaube", en: "Shed dormer", eave: true, plan: rectangle },
  {
    id: "satteldachgaube",
    de: "Satteldachgaube",
    en: "Gable dormer",
    eave: true,
    plan: ({ width, depth, meet, eave, top }) => {
      const [l, r] = [-width / 2, width / 2];

      return {
        paths: [
          [
            flat(l, 0),
            flat(0, 0),
            flat(r, 0),
            flat(r, meet),
            flat(0, depth),
            flat(l, meet),
            flat(l, 0),
          ],
          [flat(0, 0), flat(0, depth)],
        ],
        pulls: [
          { kind: "eave", height: eave },
          { kind: "ridge", height: top },
        ],
      };
    },
  },
  {
    id: "walmgaube",
    de: "Walmgaube",
    en: "Hipped dormer",
    eave: true,
    plan: ({ width, depth, meet, eave, top }) => {
      const [l, r] = [-width / 2, width / 2];
      // Its hips as steep as its cheeks, short of its back.
      const hip = flat(0, Math.min(width / 2, depth / 2));

      return {
        paths: [
          [flat(l, 0), flat(r, 0), flat(r, meet), flat(0, depth), flat(l, meet), flat(l, 0)],
          [flat(l, 0), hip, flat(r, 0)],
          [hip, flat(0, depth)],
        ],
        pulls: [
          { kind: "eave", height: eave },
          { kind: "ridge", height: top },
        ],
      };
    },
  },
  {
    id: "flachdachgaube",
    de: "Flachdachgaube",
    en: "Flat-roof dormer",
    eave: false,
    plan: (measures) => rectangle({ ...measures, eave: measures.top }),
  },
  {
    id: "zwerchhaus",
    de: "Zwerchhaus",
    en: "Wall dormer",
    eave: false,
    onEave: true,
    plan: ({ width, depth, top }) => {
      const [l, r] = [-width / 2, width / 2];

      return {
        paths: [
          [flat(l, 0), flat(0, depth), flat(r, 0)],
          [flat(0, 0), flat(0, depth)],
        ],
        // Its front is the house's eave, its gable's top and its ridge's back set.
        marks: [
          { from: flat(l, 0), to: flat(0, 0), kind: "eave" },
          { from: flat(0, 0), to: flat(r, 0), kind: "eave" },
        ],
        heights: [
          { at: flat(0, 0), height: top },
          { at: flat(0, depth), height: top },
        ],
      };
    },
  },
];
