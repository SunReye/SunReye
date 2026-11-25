// A roof face is named by its block and its place in the block (ADR 20); its key is that pair.

/** @param {import("./index.d.ts").RoofFaceId} face */
export function roofFaceKey({ block, face }) {
  return `${block}/${face}`;
}

export { addLine, loops, moveLine, removeLine, snap } from "./roof.js";

export { bent, lineKind, markLine, pullEaves, pullRidges, setHeight } from "./roof-pull.js";

export { dormers, pullDormer } from "./roof-dormer.js";

export { placeRoof, readyRoofs } from "./roof-ready.js";

export { faceCount } from "./roof-count.js";

export { centroidOf, moveBlock, removeBlock, turnBlock } from "./scene-blocks.js";

export { placeDormer, readyDormers } from "./roof-ready-dormer.js";

export { replay } from "./roof-replay.js";

export { SCENE_SCHEMA, SCENE_SCHEMA_VERSION } from "./scene-schema.js";
