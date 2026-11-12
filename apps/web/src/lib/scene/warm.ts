// The 3D scene's warm-up worker (ADR 20 Loading), ported from the prototype. It answers whether
// this browser has WebGL2 and generates the scene's noise textures, so the dashboard's main thread
// pays for neither. Its WebGL2 context also starts the browser's GPU side, which the first context
// otherwise waits for on the main thread. No three.js here: this runs before it loads.
import type { GroupName, Maps } from "./pixels.ts";

type Message = { webgl2: boolean | null } | { name: GroupName; maps: Maps } | "done";

/** Pixels the worker has delivered, by material. */
export const warmed: Partial<Record<GroupName, Maps>> = {};

const KEY = "sunreye.webgl2";

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

export interface Warm {
  /** Null when the worker cannot tell: the renderer finds out. */
  readonly webgl2: Promise<boolean | null>;
  /** Every material's pixels are in `warmed`; without a worker they are made where first used. */
  readonly textures: Promise<void>;
}

let run: Warm | undefined;

/** Starts the worker once. */
export function warm(): Warm {
  if (run !== undefined) return run;

  const webgl2 = Promise.withResolvers<boolean | null>();
  const textures = Promise.withResolvers<void>();

  const finish = (): void => {
    webgl2.resolve(null);
    textures.resolve();
  };

  run = { webgl2: webgl2.promise, textures: textures.promise };

  try {
    const worker = new Worker(new URL("./warm.worker.ts", import.meta.url), { type: "module" });

    // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- the DOM's event.
    worker.addEventListener("message", ({ data }: MessageEvent<Message>) => {
      if (data === "done") {
        worker.terminate();
        textures.resolve();
      } else if ("webgl2" in data) {
        if (data.webgl2 !== null) rememberWebgl2(data.webgl2);

        webgl2.resolve(data.webgl2);
      } else warmed[data.name] = data.maps;
    });
    worker.addEventListener("error", finish);
  } catch {
    finish();
  }

  return run;
}
