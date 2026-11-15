/// <reference types="bun" />
import { expect, test } from "bun:test";
import type { Scene } from "../builder/pv.ts";
import { body } from "./layout-change.ts";

test("a change sends every part of its scene: surfaces, fences, chimneys and openings too", () => {
  const scene: Scene = {
    north: 0,
    blocks: [],
    obstacles: [],
    surfaces: [{ x: 0, z: 9, width: 4, depth: 5, rotation: 0, finish: "paving" }],
    fences: [
      {
        points: [
          { x: 0, z: 0 },
          { x: 4, z: 0 },
        ],
        height: 1.2,
        finish: "wood",
      },
    ],
    chimneys: [{ block: 0, face: 1, across: 5, up: 3, width: 0.6, depth: 0.6, height: 1 }],
    openings: [{ kind: "frontDoor", block: 0, wall: "front", along: 4, width: 1, height: 2.1 }],
  };

  const sent: unknown = body({ appliesFrom: "2026-11-01T00:00:00Z", strings: [], scene }).scene;

  expect(sent).toMatchObject({
    surfaces: scene.surfaces,
    fences: scene.fences,
    chimneys: scene.chimneys,
    openings: scene.openings,
  });
});
