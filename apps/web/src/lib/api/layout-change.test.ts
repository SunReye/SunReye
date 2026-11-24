/// <reference types="bun" />
import { expect, test } from "bun:test";
import type { Block, Scene } from "../../../../../packages/builder/src/builder/pv.ts";
import { body } from "./layout-change.ts";

test("a change sends every part of its scene: surfaces, fences, chimneys, openings and existing PV too", () => {
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
    roofWindows: [{ block: 0, face: 1, across: 3, up: 2, width: 0.8, length: 1.2 }],
    faceDetails: [{ block: 0, face: 1, covering: "tiles", pitchConfirmed: true }],
    existingPv: [{ block: 0, face: 0, across: 5, up: 2, width: 4, length: 1.8 }],
  };

  const sent: unknown = body({ appliesFrom: "2026-11-01T00:00:00Z", strings: [], scene }).scene;

  expect(sent).toMatchObject({
    surfaces: scene.surfaces,
    fences: scene.fences,
    chimneys: scene.chimneys,
    openings: scene.openings,
    roofWindows: scene.roofWindows,
    faceDetails: scene.faceDetails,
    existingPv: scene.existingPv,
  });
});

test("a change sends a block's free-form roof as it is, its traced lines too", () => {
  const freeForm = {
    traced: {
      points: [
        [0, 3, 0],
        [4, 3, 4],
        [4, 3, 0],
      ],
      set: [0],
      lines: [
        [0, 1],
        [1, 2],
        [2, 0],
      ],
      faces: [[0, 1, 2]],
    },
    footprint: [
      [0, 0],
      [4, 0],
      [4, 4],
    ],
    faces: [
      [
        [0, 3, 0],
        [4, 3, 4],
        [4, 3, 0],
      ],
    ],
  };

  const block: Block = {
    x: 0,
    z: 0,
    width: 0,
    depth: 0,
    eave: 0,
    rotation: 0,
    roof: { kind: "flat" },
  };

  const scene: Scene = { north: 0, blocks: [{ ...block, freeForm }, block], obstacles: [] };

  const sent: unknown = body({ appliesFrom: "2026-11-01T00:00:00Z", strings: [], scene }).scene;

  expect(sent).toMatchObject({ blocks: [{ ...block, freeForm }, block] });
});

test("a change carries the inverter and battery types the layout's devices have", () => {
  const scene: Scene = { north: 0, blocks: [], obstacles: [] };
  const input = { maxCurrent: 16, minVoltage: 120, maxVoltage: 550, startVoltage: 150 };

  const types = {
    inverterTypes: {
      "1": {
        maker: "Maker",
        model: "X6",
        maxInputVoltage: 600,
        acRating: 6000,
        efficiency: 97.5,
        inputs: [input],
      },
    },
    batteryTypes: {
      "2": {
        maker: "Maker",
        model: "B10",
        usableCapacity: 9600,
        chargePower: 5000,
        dischargePower: 6000,
        roundTripEfficiency: 95,
      },
    },
  };

  const sent = body({ appliesFrom: "2026-11-01T00:00:00Z", strings: [], scene, types });

  expect(sent).toMatchObject(types);
});
