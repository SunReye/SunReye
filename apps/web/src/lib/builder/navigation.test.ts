/// <reference types="bun" />
import { expect, test } from "bun:test";
import { MOUSE, TOUCH } from "three";
import { controlsOf } from "../../../../../packages/builder/src/builder/navigation.ts";

test("the builder's own navigation orbits on a drag and pans with the right button", () => {
  const controls = controlsOf("orbit");

  expect(controls.mouseButtons).toEqual({
    LEFT: MOUSE.ROTATE,
    MIDDLE: MOUSE.DOLLY,
    RIGHT: MOUSE.PAN,
  });
  expect(controls.touches.ONE).toBe(TOUCH.ROTATE);
  expect(controls.zoomToCursor).toBe(false);
});

test("a plan pans on every button, never turns, and zooms to the cursor", () => {
  const controls = controlsOf("plan");

  expect(Object.values(controls.mouseButtons)).toEqual([MOUSE.PAN, MOUSE.PAN, MOUSE.PAN]);
  expect(controls.touches).toEqual({ ONE: TOUCH.PAN, TWO: TOUCH.DOLLY_PAN });
  expect(controls.enableRotate).toBe(false);
  expect(controls.zoomToCursor).toBe(true);
});

test("a model pans on the left and middle buttons and orbits on the right", () => {
  const controls = controlsOf("model");

  // Shift with the left button orbits: OrbitControls turns a pan with Shift into an orbit.
  expect(controls.mouseButtons).toEqual({
    LEFT: MOUSE.PAN,
    MIDDLE: MOUSE.PAN,
    RIGHT: MOUSE.ROTATE,
  });
  expect(controls.touches).toEqual({ ONE: TOUCH.ROTATE, TWO: TOUCH.DOLLY_PAN });
  expect(controls.enableRotate).toBe(true);
  expect(controls.zoomToCursor).toBe(true);
});
