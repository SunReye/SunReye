import { afterEach, expect, test } from "vitest";
import { BoxGeometry, Color, Mesh, MeshStandardMaterial, Vector3 } from "three";
import { daylight, theme } from "../../../../../../packages/builder/src/scene/light.ts";
import { look, measured, unmeasure } from "./probe.harness.ts";
import { draws, open, shut as close } from "./stage.harness.svelte.ts";

// The sun's shadow map is drawn only when what it shows changed (ADR 20 Rendering): the sun
// stands still between two ticks, and a 4096² map drawn twice a frame was a frame's largest
// fixed cost.

afterEach(() => {
  unmeasure();
  close();
});

const PAGE = new Color(0.95, 0.95, 0.96);

test("a frame at Hoch draws the shadow map once, and not again for the occlusion's own pass", () => {
  const { frame } = measured("high");

  expect(frame().shadows).toBe(1);
});

test("a frame that changes nothing the shadow shows draws no shadow map", () => {
  const { studio, frame } = measured("high");

  frame();
  expect(frame().shadows).toBe(0);

  // The camera moved: the map is the sun's view, not the camera's.
  studio.camera.position.set(-10, 6, 14);
  studio.camera.lookAt(0, 0, 0);
  expect(frame().shadows).toBe(0);

  // Ultra's burst refines the settled picture under the shadow it has.
  studio.follow(look("ultra"));
  frame();
  expect(studio.refine()).toBe(true);
  expect(frame().shadows).toBe(0);
});

test("a moved sun, a new plot, another 3D quality and a new caster each draw it once more", () => {
  const { studio, frame } = measured("high");
  const again = (): number[] => [frame().shadows, frame().shadows];

  frame();

  studio.light(daylight([0.6, 0, 0.8]), theme(false), PAGE);
  expect(again()).toEqual([1, 0]);

  // The same sun in another theme casts the same shadow.
  studio.light(daylight([0.6, 0, 0.8]), theme(true), PAGE);
  expect(again()).toEqual([0, 0]);

  studio.frame(new Vector3(2, 0, 0), 14);
  expect(again()).toEqual([1, 0]);

  studio.follow(look("medium"));
  expect(again()).toEqual([1, 0]);

  const car = new Mesh(new BoxGeometry(4, 1.5, 2), new MeshStandardMaterial());

  car.castShadow = true;
  car.position.set(8, 0.75, 0);
  studio.scene.add(car);
  studio.recast();
  expect(again()).toEqual([1, 0]);
});

test("the shadow drawn on a change is the changed one: a new caster darkens the floor under it", () => {
  const { studio, frame } = measured("low");
  const gl = studio.renderer.getContext();

  /** The picture's red at a point of the floor beside the box, away from the sun. */
  const floor = (): number => {
    const pixel = new Uint8Array(4);

    frame();
    gl.readPixels(32, 20, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);

    return pixel[0] ?? 0;
  };

  // Straight down on the plot: the sun is due south, so a shadow falls to the north.
  studio.camera.position.set(0, 40, 0.001);
  studio.camera.lookAt(0, 0, 0);

  const lit = floor();
  const wall = new Mesh(new BoxGeometry(30, 12, 1), new MeshStandardMaterial());

  wall.castShadow = true;
  wall.position.set(0, 6, 8);
  studio.scene.add(wall);
  // Not told: the old shadow stands.
  expect(Math.abs(floor() - lit)).toBeLessThanOrEqual(2);

  studio.recast();
  expect(floor()).toBeLessThan(lit - 15);
});

test("a car parked in a lit scene is a new caster: its shadow is drawn with the frame asked for", async () => {
  const { scene, drawn } = await open();
  const probe = scene.studio.measure();

  // Settled: nothing draws.
  expect(await draws(drawn)).toBe(0);

  const car = new Mesh(new BoxGeometry(4, 1.5, 2), new MeshStandardMaterial());

  car.castShadow = true;
  scene.studio.scene.add(car);
  scene.opening.recast();
  await expect.poll(() => probe.last?.shadows).toBe(1);
  // Once: the frames after find it drawn.
  scene.opening.render();
  await expect.poll(() => probe.last?.shadows).toBe(0);
});
