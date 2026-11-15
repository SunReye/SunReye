// The warm-up worker: the WebGL2 answer first, then each material's maps as they exist.
import { GROUPS } from "./pixels.ts";

let webgl2: boolean | null = null;

try {
  webgl2 = new OffscreenCanvas(1, 1).getContext("webgl2") !== null;
} catch {
  // No OffscreenCanvas here: the main thread finds out when it creates the renderer.
}

postMessage({ webgl2 });

if (webgl2 !== false) {
  for (const [name, make] of Object.entries(GROUPS)) {
    const maps = make();
    // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- their buffers move.
    const transfer = Object.values(maps).map((pixels) => pixels.data.buffer);

    postMessage({ name, maps }, { transfer });
  }
}

postMessage("done");
