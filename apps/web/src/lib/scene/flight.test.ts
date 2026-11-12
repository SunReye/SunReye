/// <reference types="bun" />
import { expect, test } from "bun:test";
import type { View } from "../builder/camera.ts";
import { course, Flight } from "./flight.ts";

const south = { position: [0, 0, 10], target: [0, 0, 0] } as const;
const east = { position: [10, 0, 0], target: [0, 0, 0] } as const;
const north = { position: [0, 0, -10], target: [0, 0, 0] } as const;
const west = { position: [-10, 0, 0], target: [0, 0, 0] } as const;

test("a flight leaves from the first view and lands on the second", () => {
  const fly = course(south, east);

  expect(fly(0).position.map((v) => Math.round(v))).toEqual([0, 0, 10]);
  expect(fly(1).position.map((v) => Math.round(v))).toEqual([10, 0, 0]);
  expect(fly(1).target).toEqual([0, 0, 0]);
});

test("a flight circles the target instead of cutting through it", () => {
  const [x, y, z] = course(south, east)(0.5).position;

  expect(Math.hypot(x, y, z)).toBeCloseTo(10);
  expect(x).toBeGreaterThan(0);
  expect(z).toBeGreaterThan(0);
});

test("a flight takes the short way round", () => {
  const [x, , z] = course(west, north)(0.5).position;

  // Through the north-west, not the long way through south and east.
  expect(x).toBeLessThan(0);
  expect(z).toBeLessThan(0);
});

test("a flight moves the target along with the camera", () => {
  const moved = { position: [20, 0, 10], target: [20, 0, 0] } as const;

  expect(course(south, moved)(0.5).target[0]).toBeCloseTo(10);
});

test("a flight steps from its first frame and stops once landed", () => {
  const flight = new Flight(() => false);
  const seen: number[] = [];

  flight.fly(south, east, ({ position }) => {
    seen.push(Math.round(position[0]));
  });

  expect(flight.step(1000)).toBe(true);
  expect(flight.step(1300)).toBe(true);
  expect(flight.step(1600)).toBe(false);
  expect(seen).toEqual([0, 7, 10]);
  expect(flight.step(2000)).toBe(false);
});

test("a new flight takes over from the last", () => {
  const flight = new Flight(() => false);
  const seen: number[] = [];

  flight.fly(south, east, () => {
    seen.push(1);
  });
  flight.fly(south, west, () => {
    seen.push(2);
  });
  flight.step(0);

  expect(seen).toEqual([2]);
});

test("a stopped flight moves the camera no more", () => {
  const flight = new Flight(() => false);
  const seen: View[] = [];

  flight.fly(south, east, (view) => {
    seen.push(view);
  });
  flight.stop();

  expect(flight.step(0)).toBe(false);
  expect(seen).toEqual([]);
});

test("a flight lands at once when nothing may move", () => {
  const flight = new Flight(() => true);
  const seen: View[] = [];

  flight.fly(south, east, (view) => {
    seen.push(view);
  });

  expect(seen.map(({ position }) => position.map((v) => Math.round(v)))).toEqual([[10, 0, 0]]);
  expect(flight.step(0)).toBe(false);
});
