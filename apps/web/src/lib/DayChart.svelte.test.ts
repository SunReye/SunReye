import { expect, test } from "vitest";
import { render } from "vitest-browser-svelte";
import { connect, type Transport } from "./api/core.ts";
import DayChart from "./DayChart.svelte";

const WIRING = { moduleType: 1, modules: 16, optimized: 0, tilt: 35, loss: 2 };

/** The owner's layout: south and north on device 1, and a string on another inverter. */
const LAYOUT = {
  appliesFrom: "2026-11-01T00:00:00Z",
  strings: [
    { ...WIRING, id: 4, name: "south", device: 1, input: 1, azimuth: 0 },
    { ...WIRING, id: 5, name: "north", device: 1, input: 1, azimuth: 180 },
    { ...WIRING, id: 6, name: "garage", device: 2, input: 1, azimuth: 0 },
  ],
};

/** A morning-to-evening triangle peaking at 1000 W: four-digit y-axis labels. */
const PEAK = [
  { start: "2026-11-09T06:00:00Z", end: "2026-11-09T06:01:00Z", mean: 0 },
  { start: "2026-11-09T12:00:00Z", end: "2026-11-09T12:01:00Z", mean: 1000 },
  { start: "2026-11-09T18:00:00Z", end: "2026-11-09T18:01:00Z", mean: 0 },
];

/** A test core: the layout, one forecast point per string, and `points` as every history. */
function testCore(points: readonly object[] = []): Transport & { readonly asked: string[] } {
  const asked: string[] = [];

  return {
    base: "http://core.test/",
    asked,
    fetch: (request) => {
      const url = new URL(request.url);

      asked.push(url.pathname + url.search);

      if (url.pathname.endsWith("/layout")) return Promise.resolve(Response.json(LAYOUT));

      if (url.pathname.endsWith("/forecasts")) {
        const target = "2026-11-09T11:00:00Z";

        return Promise.resolve(
          Response.json({ points: [{ target, issued: "2026-11-09T10:00:00Z", value: 2400 }] }),
        );
      }

      return Promise.resolve(Response.json({ tier: "raw", points }));
    },
  };
}

test("the day chart shows each of its inverter's strings' forecast", async () => {
  const transport = testCore();

  const chart = await render(DayChart, {
    core: connect(transport),
    device: 1,
    series: ["pv.power"],
  });

  await expect
    .poll(() => transport.asked.filter((path) => path.includes("/forecasts")).toSorted())
    .toEqual([
      expect.stringMatching(/^\/api\/v1\/devices\/1\/forecasts\?series=pv\.string\.power%5B4%5D&/u),
      expect.stringMatching(/^\/api\/v1\/devices\/1\/forecasts\?series=pv\.string\.power%5B5%5D&/u),
    ]);
  await expect.element(chart.getByText("south (Prognose)")).toBeVisible();
  await expect.element(chart.getByText("north (Prognose)")).toBeVisible();
});

interface Pixels {
  readonly width: number;
  readonly height: number;
  readonly data: ArrayLike<number>;
}

const NONE: Pixels = { width: 0, height: 0, data: [] };

/** The rendered chart's canvas pixels. */
function pixels(): Pixels {
  const canvas = document.querySelector("figure canvas");

  return canvas instanceof HTMLCanvasElement
    ? (canvas.getContext("2d")?.getImageData(0, 0, canvas.width, canvas.height) ?? NONE)
    : NONE;
}

/** Whether `image` holds an opaque pixel of the first series' colour, #4e79a7. */
function lined(image: Pixels): boolean {
  for (let i = 0; i < image.data.length; i += 4) {
    const [r, g, b, a] = [0, 1, 2, 3].map((k) => image.data[i + k]);

    if (a === 255 && r === 0x4e && g === 0x79 && b === 0xa7) return true;
  }

  return false;
}

/** The chart's pixels, once the first series' line has been drawn. */
async function drawn(): Promise<Pixels> {
  await expect.poll(() => lined(pixels())).toBe(true);

  return pixels();
}

/** The share of `image`'s pixels in columns `[from, to)` that carry any ink. */
function inked(image: Pixels, from = 0, to = image.width): number {
  let ink = 0;

  for (let y = 0; y < image.height; y++) {
    for (let x = from; x < to; x++) {
      if ((image.data[(y * image.width + x) * 4 + 3] ?? 0) > 0) ink++;
    }
  }

  return ink / (image.height * (to - from));
}

test("the day chart draws its lines without filling beneath them", async () => {
  await render(DayChart, { core: connect(testCore(PEAK)), device: 1, series: ["pv.power"] });

  // A filled triangle covers a fifth of the plot; strokes, grid and labels stay far below.
  expect(inked(await drawn())).toBeLessThan(0.1);
});

// Clipped text runs off the canvas' edge, leaving ink in its outermost columns.
test("the day chart's y-axis labels are not clipped at the left edge", async () => {
  await render(DayChart, { core: connect(testCore(PEAK)), device: 1, series: ["pv.power"] });

  expect(inked(await drawn(), 0, 2)).toBe(0);
});

test("the day chart's last x-axis label is not clipped at the right edge", async () => {
  await render(DayChart, { core: connect(testCore(PEAK)), device: 1, series: ["pv.power"] });

  const image = await drawn();

  expect(inked(image, image.width - 2)).toBe(0);
});
