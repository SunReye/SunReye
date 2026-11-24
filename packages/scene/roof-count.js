// How many roof faces a block has, as the pv crate lists them (ADR 20): a traced or free-form
// block its faces, a parametric one by its roof's kind.

/** Faces by parametric roof kind: a hip has four, its square one too, as triangles. */
const BY_KIND = { flat: 1, monoPitch: 1, gable: 2, hip: 4 };

/**
 * @param {import("./index.d.ts").Scene} scene
 * @param {number} block
 * @returns {number}
 */
export function faceCount(scene, block) {
  const at = scene.blocks[block];

  if (at === undefined) return 0;

  return at.freeForm ? at.freeForm.faces.length : BY_KIND[at.roof.kind];
}
