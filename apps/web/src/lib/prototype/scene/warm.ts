// PROTOTYPE: the 3D scene's warm-up worker. It answers whether this browser has WebGL2 and
// generates the scene's noise textures, so the dashboard's main thread pays for neither.
// Creating the worker's WebGL2 context also starts the browser's GPU side, which the first
// context otherwise waits for on the main thread. No three.js here: this runs before it loads.
import type { GroupName, Pixels } from "./texture-pixels";

type Maps = Record<string, Pixels>;
type Message = { webgl2: boolean | null } | { name: GroupName; maps: Maps } | "done";

/** Pixels the worker has delivered, by material. */
export const warmed: Partial<Record<GroupName, Maps>> = {};

const KEY = "proto.webgl2";

/** What the last visit found, so a browser without WebGL2 opens on the 2D flow at once. */
export function rememberedWebgl2(): boolean {
  try {
    return localStorage.getItem(KEY) !== "no";
  } catch {
    return true;
  }
}

export function rememberWebgl2(has: boolean): void {
  try {
    localStorage.setItem(KEY, has ? "yes" : "no");
  } catch {
    // Asked again next visit.
  }
}

let run: { webgl2: Promise<boolean | null>; textures: Promise<void> } | undefined;

/**
 * Starts the worker once. `webgl2` is null when the worker cannot tell (no OffscreenCanvas):
 * the scene then finds out when it creates its renderer. `textures` resolves once every
 * material's pixels are in `warmed`; without a worker they are generated where first used.
 */
export function warm(): { webgl2: Promise<boolean | null>; textures: Promise<void> } {
  if (run) return run;
  let answer!: (has: boolean | null) => void;
  let done!: () => void;
  run = { webgl2: new Promise((r) => (answer = r)), textures: new Promise((r) => (done = r)) };
  const finish = () => {
    answer(null);
    done();
  };
  try {
    const worker = new Worker(new URL("./warm.worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (e: MessageEvent<Message>) => {
      if (e.data === "done") {
        worker.terminate();
        done();
      } else if ("webgl2" in e.data) {
        if (e.data.webgl2 !== null) rememberWebgl2(e.data.webgl2);
        answer(e.data.webgl2);
      } else warmed[e.data.name] = e.data.maps;
    };
    worker.onerror = finish;
  } catch {
    finish();
  }
  return run;
}
