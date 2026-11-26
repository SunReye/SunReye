import { Color, PerspectiveCamera, Vector3 } from "three";
import { afterEach, expect, test } from "vitest";
import type { Fitted } from "../../../../../../packages/builder/src/builder/pv.ts";
import { daylight, theme } from "../../../../../../packages/builder/src/scene/light.ts";
import { look } from "./probe.harness.ts";
import { picture, SIDE } from "./studio-pixels.harness.ts";
import { Studio } from "../../../../../../packages/builder/src/scene/studio.ts";
import { lamps, openings } from "../../../../../../packages/builder/src/scene/wall-openings.ts";
import { DRY } from "../../../../../../packages/builder/src/scene/weather.ts";

const WINDOW: Fitted = {
  kind: "window",
  light: "on",
  corners: [
    [-0.6, 0, 0.9],
    [0.6, 0, 0.9],
    [0.6, 0, 2.3],
    [-0.6, 0, 2.3],
  ],
  out: [0, -1, 0],
};

let studio: Studio | undefined;

afterEach(() => {
  studio?.dispose();
  studio = undefined;
});

test.each(["low", "medium"] as const)(
  "at %s quality night fog dims window light on the ground without revealing the decal's edge",
  (quality) => {
    const camera = new PerspectiveCamera(24, 1, 0.1, 500);

    camera.position.set(0, 30, 2);
    camera.up.set(0, 0, -1);
    camera.lookAt(0, 0, 2);
    camera.updateMatrixWorld();

    const opened = new Studio(document.createElement("canvas"), camera, () => look(quality));

    studio = opened;
    opened.setSize(SIDE, SIDE);
    opened.frame(new Vector3(), 5);
    opened.scene.add(...openings([WINDOW], []));

    const at = (x: number, z: number) => {
      const seen = new Vector3(x, 0.04, z).project(camera);

      return Math.floor(((seen.y + 1) / 2) * SIDE) * SIDE + Math.floor(((seen.x + 1) / 2) * SIDE);
    };

    const edge = at(-1.4, 0.85);
    const centre = at(0, 1.47);
    const midnight = daylight([0, -0.5, -0.866]);
    const page = new Color(0.01, 0.012, 0.016);

    const draw = (fog: number, light: number): number[] => {
      opened.light(midnight, theme(true), page, { ...DRY, fog });
      lamps(opened.scene, light);
      opened.render();

      return picture(opened);
    };

    const [clearOff, clearOn, fogOff, fogOn] = [draw(0, 0), draw(0, 1), draw(1, 0), draw(1, 1)];
    const clearGlow = clearOn[centre]! - clearOff[centre]!;
    const fogGlow = fogOn[centre]! - fogOff[centre]!;

    expect(clearGlow).toBeGreaterThan(10);
    expect(clearOn[edge]! - clearOff[edge]!).toBeLessThanOrEqual(1);
    expect(fogOn[edge]! - fogOff[edge]!).toBeLessThanOrEqual(1);
    expect(fogGlow).toBeGreaterThan(2);
    expect(fogGlow).toBeLessThan(clearGlow);
  },
);
