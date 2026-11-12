// PROTOTYPE: the warm-up worker: the WebGL2 answer first, then each material's maps as they exist.
import { GROUPS, type GroupName } from "./texture-pixels";

let webgl2: boolean | null = null;
try {
  webgl2 = new OffscreenCanvas(1, 1).getContext("webgl2") !== null;
} catch {
  // No OffscreenCanvas here: the main thread finds out when it creates the renderer.
}
postMessage({ webgl2 });

if (webgl2 !== false)
  for (const name of Object.keys(GROUPS) as GroupName[]) {
    const maps = GROUPS[name]();
    postMessage({ name, maps }, { transfer: Object.values(maps).map((p) => p.data.buffer) });
  }
postMessage("done");
