/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import { spread, type Box } from "./chips.ts";

/** A phone's hero: 390 px wide. */
const PHONE = { width: 390, height: 420 };

const chip = (x: number, y: number, w = 110): Box => ({ x, y, w, h: 28 });

function overlaps(a: Box, b: Box): boolean {
  return Math.abs(a.x - b.x) < (a.w + b.w) / 2 && Math.abs(a.y - b.y) < (a.h + b.h) / 2;
}

function inside(box: Box, { width, height }: Readonly<typeof PHONE>): boolean {
  return (
    box.x - box.w / 2 >= 0 &&
    box.x + box.w / 2 <= width &&
    box.y - box.h / 2 >= 0 &&
    box.y + box.h / 2 <= height
  );
}

const CASES = {
  "all on one point": Array.from({ length: 7 }, () => chip(195, 210)),
  "a row of strings": [chip(150, 200), chip(170, 202), chip(190, 204), chip(210, 206)],
  "past every edge": [chip(-50, -40), chip(500, 600), chip(380, 10, 160), chip(5, 415, 160)],
  "beside the house": [chip(300, 150, 120), chip(300, 150, 140), chip(300, 150, 100)],
} satisfies Record<string, readonly Box[]>;

describe("chips at phone width", () => {
  for (const [name, boxes] of Object.entries(CASES)) {
    test(`${name}: never overlap and stay inside the canvas`, () => {
      const placed = spread(boxes, PHONE.width, PHONE.height);

      expect(placed).toHaveLength(boxes.length);

      for (const [i, a] of placed.entries()) {
        expect(inside(a, PHONE)).toBe(true);

        for (const b of placed.slice(i + 1)) expect(overlaps(a, b)).toBe(false);
      }
    });
  }
});

test("a lone chip inside the canvas stays where it is", () => {
  expect(spread([chip(195, 210)], PHONE.width, PHONE.height)).toEqual([chip(195, 210)]);
});

test("the input is left untouched", () => {
  const boxes = [chip(195, 210), chip(195, 210)];

  spread(boxes, PHONE.width, PHONE.height);

  expect(boxes).toEqual([chip(195, 210), chip(195, 210)]);
});
