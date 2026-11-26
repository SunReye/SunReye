import { afterEach, expect, test } from "vitest";
import "../app.css";
import { DIVERGING, FLOWS, flowColour } from "./energy-colours.ts";

const root = document.documentElement;

afterEach(() => {
  root.classList.remove("dark");
});

type Rgb = readonly [number, number, number];

/** Any CSS colour as the browser paints it: sRGB, 0 to 1. */
function painted(expression: string): Rgb {
  const probe = document.createElement("span");

  // An unset token makes `color` inherit, so the probe inherits nothing.
  probe.style.color = "transparent";
  probe.style.color = expression;
  const holder = document.createElement("div");

  holder.style.color = "transparent";
  holder.append(probe);
  document.body.append(holder);

  const computed = getComputedStyle(probe).color;

  holder.remove();

  if (computed === "rgba(0, 0, 0, 0)") throw new Error(`${expression} is not a colour`);

  const canvas = document.createElement("canvas");

  canvas.width = canvas.height = 1;

  const context = canvas.getContext("2d", { willReadFrequently: true })!;

  context.fillStyle = computed;
  context.fillRect(0, 0, 1, 1);

  const [r = 0, g = 0, b = 0] = context.getImageData(0, 0, 1, 1).data;

  return [r / 255, g / 255, b / 255];
}

function channel(c: number): number {
  return c <= 0.040_45 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function linear([r, g, b]: Rgb): Rgb {
  return [channel(r), channel(g), channel(b)];
}

function luminance(c: Rgb): number {
  const [r, g, b] = linear(c);

  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2 contrast ratio. */
function contrast(a: Rgb, b: Rgb): number {
  const [high, low] = [luminance(a), luminance(b)].toSorted((x, y) => y - x);

  return (high! + 0.05) / (low! + 0.05);
}

// Machado, Oliveira and Fernandes (2009) at severity 1, on linear sRGB.
const DEFICIENCIES = {
  protanopia: [
    [0.152_286, 1.052_583, -0.204_868],
    [0.114_503, 0.786_281, 0.099_216],
    [-0.003_882, -0.048_116, 1.051_998],
  ],
  deuteranopia: [
    [0.367_322, 0.860_646, -0.227_968],
    [0.280_085, 0.672_501, 0.047_413],
    [-0.011_82, 0.042_94, 0.968_881],
  ],
} as const;

function oklab([r, g, b]: Rgb): Rgb {
  const l = Math.cbrt(0.412_221_470_8 * r + 0.536_332_536_3 * g + 0.051_445_992_9 * b);
  const m = Math.cbrt(0.211_903_498_2 * r + 0.680_699_545_1 * g + 0.107_396_956_6 * b);
  const s = Math.cbrt(0.088_302_461_9 * r + 0.281_718_837_6 * g + 0.629_978_700_5 * b);

  return [
    0.210_454_255_3 * l + 0.793_617_785 * m - 0.004_072_046_8 * s,
    1.977_998_495_1 * l - 2.428_592_205 * m + 0.450_593_709_9 * s,
    0.025_904_037_1 * l + 0.782_771_766_2 * m - 0.808_675_766 * s,
  ];
}

type Deficiency = keyof typeof DEFICIENCIES;

/** Linear sRGB as a viewer with `deficiency` sees `c`. */
function simulate(c: Rgb, deficiency: Deficiency): Rgb {
  const lin = linear(c);

  const row = (i: number) =>
    Math.min(
      1,
      Math.max(
        0,
        DEFICIENCIES[deficiency][i]!.reduce((t, k, j) => t + k * lin[j]!, 0),
      ),
    );

  return [row(0), row(1), row(2)];
}

/** OKLab distance ×100 as a viewer with `deficiency` sees the two colours. */
function seen(a: Rgb, b: Rgb, deficiency: Deficiency): number {
  const [x, y] = [oklab(simulate(a, deficiency)), oklab(simulate(b, deficiency))];

  return 100 * Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);
}

const THEMES = ["light", "dark"] as const;
const SURFACES = ["--background", "--card", "--popover"] as const;

/** Every colour that encodes data: the flows, then the diverging pair. */
const MARKS = [...FLOWS.map((flow) => flowColour(flow)), DIVERGING.under, DIVERGING.over];

test("every energy and diverging colour reaches 3:1 as a mark on every surface in both themes", () => {
  for (const theme of THEMES) {
    root.classList.toggle("dark", theme === "dark");

    for (const surface of SURFACES) {
      for (const mark of MARKS) {
        expect(
          contrast(painted(mark), painted(`var(${surface})`)),
          `${theme} ${mark} on ${surface}`,
        ).toBeGreaterThanOrEqual(3);
      }
    }
  }
});

test("colour-blind viewers tell every pair of energy colours apart in both themes", () => {
  for (const theme of THEMES) {
    root.classList.toggle("dark", theme === "dark");

    // Every flow can sit beside every other in the 2D flow, so all pairs count.
    for (const [i, a] of FLOWS.entries()) {
      for (const b of FLOWS.slice(i + 1)) {
        for (const deficiency of ["protanopia", "deuteranopia"] as const) {
          // 8 is the target for categorical marks under this simulation.
          expect(
            seen(painted(flowColour(a)), painted(flowColour(b)), deficiency),
            `${theme} ${a}/${b} with ${deficiency}`,
          ).toBeGreaterThanOrEqual(8);
        }
      }
    }
  }
});

test("colour-blind viewers tell under from over in both themes", () => {
  for (const theme of THEMES) {
    root.classList.toggle("dark", theme === "dark");

    for (const deficiency of ["protanopia", "deuteranopia"] as const) {
      expect(
        seen(painted(DIVERGING.under), painted(DIVERGING.over), deficiency),
        `${theme} ${deficiency}`,
      ).toBeGreaterThanOrEqual(8);
    }
  }
});

test("no flow is blue, so the brand blue marks only controls", () => {
  for (const theme of THEMES) {
    root.classList.toggle("dark", theme === "dark");

    for (const flow of FLOWS) {
      const [, a, b] = oklab(linear(painted(flowColour(flow))));
      const hue = (Math.atan2(b, a) * 180) / Math.PI;

      // Below 0.03 chroma a colour reads as grey; blue-600 sits at hue 263.
      if (Math.hypot(a, b) >= 0.03) {
        expect((hue + 360) % 360, `${theme} ${flow}`).not.toSatisfy(
          (h: number) => h > 225 && h < 285,
        );
      }
    }
  }
});
