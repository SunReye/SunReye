import { afterEach, expect, test, vi } from "vitest";
import { render } from "vitest-browser-svelte";
import { haptics } from "../haptics.ts";
import Plot from "./reader.harness.svelte";
import { ChartReader, type Readable } from "./reader.svelte.ts";

// A plot 400 px wide read in four bands of 100 px; a place is its band's index.
const plot = () => document.querySelector<HTMLElement>("[data-plot]")!;

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

interface Told {
  drilled: number[];
  narrowed: [number, number][];
}

const four: Readable<number> = {
  over: (x) => Math.min(3, Math.floor(x * 4)),
  band: (p) => p,
};

// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- the reader is driven in place.
async function mount(read: ChartReader<number>) {
  await render(Plot, { props: { read } });
  // A synthetic pointer has no capture to take.
  plot().setPointerCapture = () => {};
}

async function reader(hold: boolean, chart: Partial<Readable<number>> = {}) {
  const told: Told = { drilled: [], narrowed: [] };

  const read = new ChartReader<number>(
    () => ({
      ...four,
      step: (from, key) => {
        const was = from ?? 0;

        if (key === "ArrowLeft") return Math.max(0, was - 1);

        return key === "ArrowRight" ? Math.min(3, was + 1) : undefined;
      },
      drill: (p) => (told.drilled.push(p), true),
      brush: (a, b) => (a === b ? false : (told.narrowed.push([a, b]), true)),
      ...chart,
    }),
    { hold },
  );

  await mount(read);

  return { read, told };
}

/** A pointer's event over band `band`'s middle, `dy` px below the plot's middle. */
function at(type: string, band: number, kind = "touch", dy = 0): void {
  plot().dispatchEvent(
    new PointerEvent(type, {
      pointerType: kind,
      pointerId: 7,
      clientX: band * 100 + 50,
      clientY: 50 + dy,
      button: 0,
      buttons: 1,
      bubbles: true,
    }),
  );
}

/** A mouse's event at `x` px across the plot, its buttons held or not. */
function mouse(type: string, x: number, buttons = 1): void {
  plot().dispatchEvent(
    new PointerEvent(type, {
      pointerType: "mouse",
      pointerId: 1,
      clientX: x,
      clientY: 50,
      button: 0,
      buttons,
      bubbles: true,
    }),
  );
}

const key = (k: string, shiftKey = false) => {
  plot().dispatchEvent(new KeyboardEvent("keydown", { key: k, shiftKey, bubbles: true }));
};

test("a mouse reads where it hovers, silently, and leaving clears it", async () => {
  const tick = vi.spyOn(haptics, "selection");
  const { read } = await reader(false);

  at("pointermove", 2, "mouse");
  expect(read.at).toBe(2);

  at("pointermove", 1, "mouse");
  expect(read.at).toBe(1);

  at("pointerleave", 1, "mouse");
  expect(read.at).toBeNull();
  expect(tick).not.toHaveBeenCalled();
});

test("on a full screen a finger reads at once, ticks as it crosses a band, and stays read lifted", async () => {
  const tick = vi.spyOn(haptics, "selection");
  const { read, told } = await reader(false);

  at("pointerdown", 1);
  expect(read.at).toBe(1);
  expect(tick).toHaveBeenCalledTimes(1);

  at("pointermove", 1, "touch", 5);
  expect(tick).toHaveBeenCalledTimes(1);

  at("pointermove", 3);
  expect(read.at).toBe(3);
  expect(tick).toHaveBeenCalledTimes(2);

  at("pointerup", 3);
  at("pointerleave", 3);
  expect(read.at).toBe(3);
  expect(read.pinned).toBe(true);
  expect(told.drilled).toEqual([]);

  read.open();
  expect(told.drilled).toEqual([3]);
});

test("on a full screen a tap drills, and a finger the browser takes to scroll reads nothing", async () => {
  const { read, told } = await reader(false);

  at("pointerdown", 2);
  at("pointerup", 2);
  expect(told.drilled).toEqual([2]);

  at("pointerdown", 0);
  at("pointercancel", 0);
  expect(read.at).toBeNull();
  expect(read.pinned).toBe(false);
});

test("in a sheet a finger reads only once held, then leads; lifted, the reading ends", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });

  const tick = vi.spyOn(haptics, "selection");
  const { read } = await reader(true);

  at("pointerdown", 1);
  // The drawer leaves a finger alone from touch-down, not from the reading.
  expect("vaulNoDrag" in plot().dataset).toBe(true);
  vi.advanceTimersByTime(200);
  expect(read.at).toBeNull();

  vi.advanceTimersByTime(100);
  expect(read.at).toBe(1);
  expect(tick).toHaveBeenCalledTimes(1);

  at("pointermove", 2);
  expect(read.at).toBe(2);
  expect(tick).toHaveBeenCalledTimes(2);

  at("pointerup", 2);
  expect(read.at).toBeNull();
  expect("vaulNoDrag" in plot().dataset).toBe(false);
});

test("in a sheet a finger that moves before it holds scrolls, and a quick tap drills", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });

  const { read, told } = await reader(true);

  at("pointerdown", 1);
  at("pointermove", 1, "touch", 30);
  vi.advanceTimersByTime(1000);
  expect(read.at).toBeNull();

  at("pointerdown", 3);
  at("pointerup", 3);
  vi.advanceTimersByTime(1000);
  expect(told.drilled).toEqual([3]);
  expect(read.at).toBeNull();
});

test("a mouse drag across bands narrows to them; a click drills its band", async () => {
  const { read, told } = await reader(false);

  at("pointerdown", 0, "mouse");
  at("pointermove", 2, "mouse");
  expect(read.brush).toEqual([0, 2]);

  at("pointerup", 2, "mouse");
  expect(told.narrowed).toEqual([[0, 2]]);
  expect(read.brush).toBeNull();
  expect(told.drilled).toEqual([]);

  at("pointerdown", 1, "mouse");
  at("pointerup", 1, "mouse");
  expect(told.drilled).toEqual([1]);
});

test("a click that jitters across a band's edge drills its band, never narrows", async () => {
  const { read, told } = await reader(false);

  mouse("pointerdown", 98);
  mouse("pointermove", 101);
  expect(read.brush).toBeNull();

  mouse("pointerup", 101);
  expect(told.narrowed).toEqual([]);
  expect(told.drilled).toEqual([0]);
});

test("a press let go outside the plot leaves hovering to read and clear again", async () => {
  const { read } = await reader(false, { brush: undefined });

  mouse("pointerdown", 150);
  mouse("pointerleave", 450);
  // Back over the plot with no button held: the press ended outside.
  mouse("pointermove", 250, 0);
  expect(read.at).toBe(2);

  mouse("pointerleave", 450, 0);
  expect(read.at).toBeNull();
});

test("a chart that cannot narrow never brushes", async () => {
  const { read } = await reader(false, { brush: undefined });

  at("pointerdown", 0, "mouse");
  at("pointermove", 2, "mouse");
  expect(read.brush).toBeNull();
});

test("keys move the reading, ticking, Shift selects a span, Enter narrows and Escape clears", async () => {
  const tick = vi.spyOn(haptics, "selection");
  const { read, told } = await reader(false);

  key("ArrowRight");
  expect(read.at).toBe(1);
  expect(read.pinned).toBe(true);
  expect(tick).toHaveBeenCalledTimes(1);

  key("ArrowRight", true);
  key("ArrowRight", true);
  expect(read.brush).toEqual([1, 3]);

  key("Enter");
  expect(told.narrowed).toEqual([[1, 3]]);

  key("ArrowLeft");
  key("Enter");
  expect(told.drilled).toEqual([read.at]);

  key("Escape");
  expect(read.at).toBeNull();
  expect(read.pinned).toBe(false);
});

test("a reading kept by the caller is read and written there; the caller's own writes are silent", async () => {
  const tick = vi.spyOn(haptics, "selection");
  let kept: number | null = null;
  const told: number[] = [];

  const read = new ChartReader<number>(() => four, {
    hold: false,
    store: {
      get: () => kept,
      set: (p) => {
        kept = p;
        told.push(p ?? -1);
      },
    },
  });

  await mount(read);

  kept = 2;
  expect(read.at).toBe(2);
  expect(tick).not.toHaveBeenCalled();

  at("pointermove", 1, "mouse");
  expect(kept).toBe(1);
  expect(told).toEqual([1]);
});
