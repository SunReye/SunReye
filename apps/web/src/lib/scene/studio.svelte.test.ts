import { afterEach, expect, test } from "vitest";
import { Color, Fog, PerspectiveCamera, Texture } from "three";
import { daylight, theme } from "./light.ts";
import { Studio } from "./studio.ts";

let studio: Studio | undefined;

function open(): Studio {
  const canvas = document.createElement("canvas");

  document.body.append(canvas);
  studio = new Studio(canvas, new PerspectiveCamera(40, 1, 0.1, 5000));
  studio.setSize(64, 64);

  return studio;
}

afterEach(() => {
  studio?.dispose();
  studio = undefined;
});

test("the ambient-occlusion pass runs on the full motion tier only", () => {
  const opened = open();

  opened.follow("full");
  expect(opened.occlusion).toBe(true);
  opened.follow("lite");
  expect(opened.occlusion).toBe(false);
  opened.follow("still");
  expect(opened.occlusion).toBe(false);
});

test("light and dark themes change the background, the fog and the exposure", () => {
  const opened = open();
  const noon = daylight([0, -0.5, 0.866]);

  opened.light(noon, theme(false), new Color(0.95, 0.95, 0.96));

  const light = {
    exposure: opened.renderer.toneMappingExposure,
    background: opened.scene.background,
    fog: opened.scene.fog instanceof Fog ? opened.scene.fog.color.getHex() : null,
  };

  opened.light(noon, theme(true), new Color(0.01, 0.012, 0.016));

  expect(light.background).toBeInstanceOf(Texture);
  expect(opened.scene.background).toBeInstanceOf(Texture);
  expect(opened.scene.background).not.toBe(light.background);
  expect(opened.renderer.toneMappingExposure).toBeLessThan(light.exposure);
  expect(opened.scene.fog instanceof Fog ? opened.scene.fog.color.getHex() : null).not.toBe(
    light.fog,
  );
});
