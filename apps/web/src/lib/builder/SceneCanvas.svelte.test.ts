import "../../app.css";
import { expect, test } from "vitest";
import { userEvent } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import { presetView, type View } from "./camera.ts";
import type { Hit } from "./scene.ts";
import type { Geometry } from "./pv.ts";
import SceneCanvas from "./SceneCanvas.svelte";

// Software GL renders the sky and shadows slowly while other suites run.
const SLOW = { timeout: 15_000 };

const house: Geometry = {
  faces: [
    {
      surface: "roof",
      corners: [
        [0, 0, 3],
        [10, 0, 3],
        [10, -8, 3],
        [0, -8, 3],
      ],
    },
  ],
  solids: [{ kind: "sphere", centre: [-4, 0, 8], radius: 2 }],
};

test("the scene is drawn on a labelled canvas", async () => {
  const screen = await render(SceneCanvas, {
    geometry: house,
    view: presetView("isometric", house),
    onview: () => {},
  });

  await expect.element(screen.getByLabelText("3D-Szene des Hauses")).toBeVisible();
});

test("dragging the canvas orbits the camera and reports the new view", async () => {
  const start = presetView("south", house);
  const views: View[] = [];

  const screen = await render(SceneCanvas, {
    geometry: house,
    view: start,
    onview: (view: View) => {
      views.push(view);
    },
  });

  const canvas = screen.getByLabelText("3D-Szene des Hauses");

  await userEvent.dragAndDrop(canvas, canvas, {
    sourcePosition: { x: 100, y: 100 },
    targetPosition: { x: 250, y: 100 },
  });

  await expect.poll(() => views.length, SLOW).toBeGreaterThan(0);
  expect(views.at(-1)?.target).toEqual(start.target);
  expect(views.at(-1)?.position).not.toEqual(start.position);
});

/** Height of a south roof at 30°: its eave at 3 m, 4 m south of its ridge. */
const rise = (north: number): number => 3 + (north + 4) * Math.tan(Math.PI / 6);

/** A 4 m wide south roof covered by four modules of string 0. */
const roof: Geometry = {
  faces: [
    {
      surface: "roof",
      corners: [
        [0, -4, rise(-4)],
        [4, -4, rise(-4)],
        [4, 0, rise(0)],
        [0, 0, rise(0)],
      ],
    },
  ],
  solids: [],
};

const modules = [
  [0, -4],
  [2, -4],
  [0, -2],
  [2, -2],
].map(([east = 0, north = 0]: readonly number[]) => ({
  corners: [
    [east, north, rise(north) + 0.01],
    [east + 2, north, rise(north) + 0.01],
    [east + 2, north + 2, rise(north + 2) + 0.01],
    [east, north + 2, rise(north + 2) + 0.01],
  ] as const,
  string: 0,
  grid: 0,
}));

/** The mean colour of a patch of RGBA pixels. */
function average(data: ArrayLike<number>): [number, number, number] {
  const channel = (offset: number): number =>
    Array.from({ length: data.length / 4 }, (_, i) => data[i * 4 + offset] ?? 0).reduce(
      (sum, v) => sum + v,
      0,
    ) /
    (data.length / 4);

  return [channel(0), channel(1), channel(2)];
}

/** Draws the roof close-up; the reader gives the canvas's middle as last drawn. */
async function closeUp(
  dark: boolean,
  covered = true,
  onpick?: (hit: Hit) => void,
): Promise<{
  drawn: () => [number, number, number] | undefined;
  screen: Awaited<ReturnType<typeof render<typeof SceneCanvas>>>;
}> {
  document.documentElement.classList.toggle("dark", dark);

  const read = document.createElement("canvas");
  const context = read.getContext("2d", { willReadFrequently: true });
  let pixel: [number, number, number] | undefined;

  const screen = await render(SceneCanvas, {
    geometry: roof,
    panels: covered ? modules : [],
    // Live, at noon: no string makes anything.
    shares: covered ? modules.map(() => 0) : [],
    sun: [0, -0.5, 0.866],
    // From the south, 34° above the horizon.
    view: { position: [2, 4.15 + 4.47, 2 + 6.63], target: [2, 4.15, 2] },
    onview: () => {},
    onpick,
    // Read in the draw that made it: the drawing buffer is cleared once presented.
    onrender: () => {
      const canvas = document.querySelector("canvas");

      if (canvas === null || context === null || canvas.width === 0) return;

      read.width = canvas.width;
      read.height = canvas.height;
      context.drawImage(canvas, 0, 0);

      pixel = average(context.getImageData(canvas.width / 2 - 4, canvas.height / 2 - 4, 9, 9).data);
    },
  });

  return { drawn: () => pixel, screen };
}

/** One sRGB byte, linear. */
function linear(c: number): number {
  return c / 255 <= 0.04045 ? c / 255 / 12.92 : ((c / 255 + 0.055) / 1.055) ** 2.4;
}

/** CIELAB's companding. */
function f(t: number): number {
  return t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116;
}

interface Lab {
  readonly lightness: number;
  readonly chroma: number;
}

/** CIELAB lightness and chroma of an sRGB colour, D65. */
function lab([r, g, b]: readonly [number, number, number]): Lab {
  const [lr, lg, lb] = [linear(r), linear(g), linear(b)];
  const x = f((0.4124 * lr + 0.3576 * lg + 0.1805 * lb) / 0.95047);
  const y = f(0.2126 * lr + 0.7152 * lg + 0.0722 * lb);
  const z = f((0.0193 * lr + 0.1192 * lg + 0.9505 * lb) / 1.08883);

  return { lightness: 116 * y - 16, chroma: Math.hypot(500 * (x - y), 200 * (y - z)) };
}

test.each([false, true])(
  "modules read black, not blue or violet, in the roof close-up at noon (dark %s)",
  async (dark) => {
    const { drawn } = await closeUp(dark);

    // Near black, and too grey to read as any hue.
    await expect.poll(() => lab(drawn() ?? [255, 255, 255]).lightness, SLOW).toBeLessThan(10);
    await expect.poll(() => lab(drawn() ?? [255, 255, 255]).chroma, SLOW).toBeLessThan(12);
  },
);

test("a new sun relights the scene: below the horizon only the moon lights the roof", async () => {
  const { drawn, screen } = await closeUp(false, false);
  const lightness = (): number => lab(drawn() ?? [0, 0, 0]).lightness;

  await expect.poll(lightness, SLOW).toBeGreaterThan(30);

  const noon = lightness();

  await screen.rerender({ sun: [0, -0.5, -0.866] });
  await expect.poll(lightness, SLOW).toBeLessThan(noon - 15);
});

test("a click on a module reports its grid; on the bare roof, the point it struck", async () => {
  const hits: Hit[] = [];

  const covered = await closeUp(true, true, (hit) => {
    hits.push(hit);
  });

  await covered.screen.getByLabelText("3D-Szene des Hauses").click();

  await expect.poll(() => hits).toEqual([{ kind: "grid", grid: 0 }]);
  await covered.screen.unmount();

  const bare = await closeUp(true, false, (hit) => {
    hits.push(hit);
  });

  await bare.screen.getByLabelText("3D-Szene des Hauses").click();

  await expect.poll(() => hits.length).toBe(2);
  const [east = 0, north = 0, up = 0] = hits[1]?.kind === "point" ? hits[1].point : [];

  // The view's target, on the roof 2 m east and 2 m south of the ridge's end.
  expect([east, north, up].map((value) => Math.round(value))).toEqual([
    2,
    -2,
    Math.round(rise(-2)),
  ]);
});

test("a drag orbits and picks nothing", async () => {
  const hits: Hit[] = [];

  const { screen } = await closeUp(true, false, (hit) => {
    hits.push(hit);
  });

  const canvas = screen.getByLabelText("3D-Szene des Hauses");

  await userEvent.dragAndDrop(canvas, canvas, {
    sourcePosition: { x: 100, y: 100 },
    targetPosition: { x: 250, y: 100 },
  });
  await canvas.click();

  await expect.poll(() => hits.length).toBe(1);
});
