import "../../../app.css";
import { afterEach, expect, test } from "vitest";
import { cdp, page } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import { presetView, type View } from "../camera.ts";
import { house, press, pv, type Pointer } from "../builder.harness.ts";
import type { Point, Scene } from "../pv.ts";
import type { Projector } from "../drawing.svelte.ts";
import SceneCanvas from "../SceneCanvas.svelte";
import { handles, type Target, type Triple } from "./grips.ts";

// Software GL renders the sky and shadows slowly while other suites run.
const SLOW = { timeout: 15_000 };

const BLOCK: Target = { kind: "block", index: 0 };

/** A three.js point as the pv crate's: east, north, up. */
const point = ([x, y, z]: Triple): Point => [x, 0 - z, y];

async function stage(scene: Scene, target = BLOCK) {
  const dragged: Scene[] = [];
  const dropped: number[] = [];
  const views: View[] = [];
  let project: Projector | undefined;
  let ready = false;

  const geometry = pv.geometry(scene);

  const screen = await render(SceneCanvas, {
    geometry,
    view: presetView("isometric", geometry),
    onview: (view: View) => {
      views.push(view);
    },
    onrender: (next: Projector) => {
      project = next;
    },
    onready: () => {
      ready = true;
    },
    editing: {
      scene,
      target,
      pv,
      laid: pv.modules(scene, {}),
      turning: false,
      ondrag: (next: Scene) => {
        dragged.push(next);
      },
      ondrop: () => {
        dropped.push(dragged.length);
      },
    },
  });

  await expect.poll(() => ready, SLOW).toBe(true);

  const canvas = screen.getByLabelText("3D-Szene des Hauses").element().getBoundingClientRect();

  /** A three.js point on the page, in pixels. */
  const onPage = (at: Triple): readonly [number, number] => {
    const [x = 0, y = 0] = project?.(point(at)) ?? [];

    return [canvas.left + x, canvas.top + y];
  };

  return { dragged, dropped, views, onPage, corner: [canvas.left + 30, canvas.top + 30] as const };
}

afterEach(async () => {
  await page.viewport(1280, 900);
});

test.each<Pointer>(["mouse", "pen", "touch"])(
  "a %s drags the width arrow outward: wider, one drop, no orbit",
  async (kind) => {
    const scene = house().scene;
    const { dragged, dropped, views, onPage } = await stage(scene);
    const arrow = handles(scene, BLOCK).find(({ grip }) => grip === "width");

    if (arrow?.axis === undefined) throw new Error("no width arrow");

    const [ax, ay, az] = arrow.at;
    const [dx, , dz] = arrow.axis;
    const start = onPage(arrow.at);
    const end = onPage([ax + dx * 2, ay, az + dz * 2]);
    const middle = [(start[0] + end[0]) / 2, (start[1] + end[1]) / 2] as const;

    await press(kind, [start, middle, end]);

    await expect.poll(() => dropped).toEqual([dragged.length]);

    const width = dragged.at(-1)?.blocks[0]?.width ?? 0;

    expect(width).toBeGreaterThan(11);
    expect(width).toBeLessThan(13);
    expect(views).toEqual([]);
  },
);

test("a fence point drags along the ground: moved, the other points kept, one drop", async () => {
  const scene: Scene = {
    ...house().scene,
    fences: [
      {
        points: [
          { x: 0, z: 10 },
          { x: 6, z: 10 },
        ],
        height: 1.2,
        finish: "wood",
      },
    ],
  };

  const fence: Target = { kind: "fence", index: 0 };
  const { dragged, dropped, views, onPage } = await stage(scene, fence);
  const knob = handles(scene, fence)[1];

  if (knob === undefined) throw new Error("no point handle");

  const [ax, ay, az] = knob.at;
  const from = onPage(knob.at);
  const end = onPage([ax + 2, ay, az]);
  const middle = [(from[0] + end[0]) / 2, (from[1] + end[1]) / 2] as const;

  await press("mouse", [from, middle, end]);

  await expect.poll(() => dropped).toEqual([dragged.length]);

  const [first, moved] = dragged.at(-1)?.fences?.[0]?.points ?? [];

  expect(first).toEqual({ x: 0, z: 10 });
  expect(moved?.x).toBeGreaterThan(7);
  expect(moved?.x).toBeLessThan(9);
  expect(views).toEqual([]);
});

test("a drag on open ground orbits and drags nothing", async () => {
  const scene = house().scene;
  const { dragged, views, corner } = await stage(scene);
  const [x, y] = corner;

  await press("mouse", [
    [x, y],
    [x + 60, y],
    [x + 120, y],
  ]);

  await expect.poll(() => views.length, SLOW).toBeGreaterThan(0);
  expect(dragged).toEqual([]);
});

test("the live value shows beside the handle while it drags", async () => {
  const scene = house().scene;
  const { onPage } = await stage(scene);
  const arrow = handles(scene, BLOCK).find(({ grip }) => grip === "width");

  if (arrow?.axis === undefined) throw new Error("no width arrow");

  const [ax, ay, az] = arrow.at;
  const [x, y] = onPage(arrow.at);
  const [ex, ey] = onPage([ax + arrow.axis[0] * 2, ay, az + arrow.axis[2] * 2]);

  await cdp().send("Input.dispatchMouseEvent", { type: "mousePressed", button: "left", x, y });
  await cdp().send("Input.dispatchMouseEvent", {
    type: "mouseMoved",
    button: "left",
    buttons: 1,
    x: ex,
    y: ey,
  });

  const value = page.getByRole("status").getByText(/^1[12],\d m$/u);

  await expect.element(value).toBeVisible();

  await cdp().send("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    button: "left",
    x: ex,
    y: ey,
  });

  await expect.element(value).not.toBeInTheDocument();
});

/** How far the camera stands from what it looks at. */
const distance = ({ position, target }: View): number =>
  Math.hypot(...position.map((p, i) => p - (target[i] ?? 0)));

/** Two fingers from `from` to `to`, each pair in page pixels. */
async function twoFingers(
  from: readonly (readonly [number, number])[],
  to: readonly (readonly [number, number])[],
): Promise<void> {
  const points = (pair: readonly (readonly [number, number])[], step: number) =>
    pair.map(([x, y], id) => {
      const [tx = x, ty = y] = to[id] ?? [];

      return { x: x + ((tx - x) * step) / 4, y: y + ((ty - y) * step) / 4, id: id + 1 };
    });

  await cdp().send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: points(from, 0),
  });

  for (const step of [1, 2, 3, 4]) {
    // oxlint-disable-next-line no-await-in-loop -- fingers move one step at a time.
    await cdp().send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: points(from, step),
    });
  }

  await cdp().send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
}

test("two fingers spreading zoom in and drag nothing", SLOW, async () => {
  const scene = house().scene;
  const { dragged, views, corner } = await stage(scene);
  const start = presetView("isometric", pv.geometry(scene));
  const [x, y] = corner;

  await twoFingers(
    [
      [x + 80, y],
      [x + 120, y],
    ],
    [
      [x, y],
      [x + 200, y],
    ],
  );

  await expect.poll(() => views.length, SLOW).toBeGreaterThan(0);
  expect(distance(views.at(-1) ?? start)).toBeLessThan(distance(start));
  expect(dragged).toEqual([]);
});

test(
  "two fingers on the selected house zoom too: the first finger's drag is let go",
  SLOW,
  async () => {
    const scene = house().scene;
    const { dragged, views, onPage } = await stage(scene);
    const start = presetView("isometric", pv.geometry(scene));
    const [x, y] = onPage([5, 0, 4]);

    await twoFingers(
      [
        [x - 20, y],
        [x + 20, y],
      ],
      [
        [x - 100, y],
        [x + 100, y],
      ],
    );

    await expect.poll(() => views.length, SLOW).toBeGreaterThan(0);
    expect(distance(views.at(-1) ?? start)).toBeLessThan(distance(start));
    // Whatever the first finger moved is put back, and nothing is recorded.
    expect(dragged.at(-1) ?? scene).toEqual(scene);
  },
);
