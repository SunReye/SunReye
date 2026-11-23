// A roof face is named by its block and its place in the block (ADR 20); its key is that pair.

/** @param {import("./index.d.ts").RoofFaceId} face */
export function roofFaceKey({ block, face }) {
  return `${block}/${face}`;
}
