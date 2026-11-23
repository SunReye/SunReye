// Component test files that emulate touch: each runs alone in a tab of its own (vite.config.ts).
// Playwright gives headless Chromium its mouse by a launch flag; once a tab's touch emulation is
// set, on or off, the tab has no pointer and no hover, and nothing over CDP brings the mouse back.
// A file after it in that tab finds every hover style and popover gone (page.setup.ts says so).

import { readdirSync, readFileSync } from "node:fs";
import { matchesGlob } from "node:path";
import { SCENE } from "./scene-tests.ts";

/** What a file says to emulate touch. */
const EMULATES = /Emulation\.setTouchEmulationEnabled/u;

export interface TouchFile {
  /** Relative to the app, as vitest's globs are. */
  readonly file: string;
  /** It draws the scene, so it runs in the serial scene group. */
  readonly scene: boolean;
}

/** The component test files under `src/` whose source emulates touch, in path order. */
export function touchFiles(app: string): TouchFile[] {
  return readdirSync(`${app}/src`, { recursive: true, encoding: "utf8" })
    .filter((path) => path.endsWith(".svelte.test.ts"))
    .filter((path) => EMULATES.test(readFileSync(`${app}/src/${path}`, "utf8")))
    .map((path) => `src/${path}`)
    .toSorted()
    .map((file) => ({ file, scene: SCENE.some((glob) => matchesGlob(file, glob)) }));
}
