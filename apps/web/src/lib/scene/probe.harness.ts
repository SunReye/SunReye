// Shared by the tests that count what a frame draws: a studio on a canvas of a size and pixel
// ratio the test names, a house-sized box in it, and its probe.
import { BoxGeometry, Color, Mesh, MeshStandardMaterial, PerspectiveCamera, Vector3 } from "three";
import { cdp } from "vitest/browser";
import { daylight, theme } from "./light.ts";
import type { Frame } from "./probe.ts";
import { drawn, type Level } from "./quality.ts";
import { Studio } from "./studio.ts";

let studio: Studio | undefined;

/** A phone's screen: 390 by 600 CSS pixels of canvas at a pixel ratio of 3. */
export const PHONE = { width: 390, height: 600, ratio: 3 } as const;

/** Emulates a screen of `ratio` device pixels per CSS pixel; none puts the browser's back. */
export async function screen(ratio?: number): Promise<void> {
  await (ratio === undefined
    ? cdp().send("Emulation.clearDeviceMetricsOverride")
    : cdp().send("Emulation.setDeviceMetricsOverride", {
        width: 800,
        height: 900,
        deviceScaleFactor: ratio,
        mobile: false,
      }));
}

/** What a level draws on the full tier, on any device. */
export const look = (level: Level) => drawn(level, { capable: false, steps: 0, tier: "full" });

/** A studio at `level`, lit at noon, with a box that casts and catches the sun's shadow. */
export function measured(
  level: Level,
  [width, height]: readonly [number, number] = [64, 64],
  clock?: () => number,
) {
  const canvas = document.createElement("canvas");

  document.body.append(canvas);
  shut();
  studio = new Studio(canvas, new PerspectiveCamera(40, width / height, 0.1, 5000), () =>
    look(level),
  );
  studio.setSize(width, height);

  const box = new Mesh(new BoxGeometry(4, 3, 4), new MeshStandardMaterial());

  box.castShadow = box.receiveShadow = true;
  studio.camera.position.set(12, 9, 12);
  studio.camera.lookAt(0, 0, 0);
  studio.scene.add(box);
  studio.frame(new Vector3(), 10);
  studio.light(daylight([0, -0.5, 0.866]), theme(false), new Color(0.95, 0.95, 0.96));

  const probe = studio.measure(clock);
  const opened = studio;

  return {
    studio: opened,
    probe,
    /** Draws a frame and tells what it drew. */
    frame: (): Frame => {
      opened.render();

      if (probe.last === undefined) throw new TypeError("no frame was counted");

      return probe.last;
    },
  };
}

/** Frees the studio opened: after each test. */
export function shut(): void {
  studio?.dispose();
  studio?.renderer.domElement.remove();
  studio = undefined;
}

/** A pass as a line: where it drew, and how large. */
export const told = ({ passes }: Frame): string[] =>
  passes.map(
    ({ target, width, height, samples }) =>
      `${target} ${width}×${height}${samples > 0 ? ` ×${samples}` : ""}`,
  );
