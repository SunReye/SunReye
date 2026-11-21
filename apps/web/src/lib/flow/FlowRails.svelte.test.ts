// Ported from v3 (dev 780b4e2, _shared/power-flow-rails.svelte.test.ts); the tier is a prop here.
import { expect, test } from "vitest";
import { render } from "vitest-browser-svelte";
import { finish } from "../motion/animations.harness.ts";
import type { MotionTier } from "../motion/tier.ts";
import { BEAD_COUNT, railPulse } from "./flow-pulse.ts";
import FlowRails from "./FlowRails.svelte";
import type { Direction, RailLine } from "./schematic.ts";

// What the rails DRAW for a reading: which rails carry a charge, which way it
// flies, how fast, and what each motion tier is left with. The numbers
// themselves (`railPulse`, `moverKeyPoints`) are `flow-pulse.test.ts`.

const CEILING = 9000;

function rail(id: string, flow: Direction, watts: number, y: number): RailLine {
  return {
    id,
    flow,
    color: "var(--e-solar)",
    pulse: railPulse(watts, CEILING),
    d: `M 10 ${y} L 290 ${y}`,
  };
}

const PV = rail("pv", "in", 3000, 20);
const GRID = rail("grid", "out", 6000, 60);
const IDLE = rail("gen", "in", 0, 100);

function mount(
  tier: MotionTier,
  flowing: readonly RailLine[],
  lines: readonly RailLine[] = [PV, GRID, IDLE],
) {
  return render(FlowRails, { lines, flowing, tier, width: 300, height: 120 });
}

/** The flying charge on the rail whose cable is drawn along `d`. */
function charge(container: Element, d: string) {
  const cable = [...container.querySelectorAll("path[id]")].find((p) => p.getAttribute("d") === d);

  if (!cable) throw new Error(`no cable along ${d}`);

  const movers = [...container.querySelectorAll("svg animateMotion")].filter(
    (m) => m.querySelector("mpath")?.getAttribute("href") === `#${cable.id}`,
  );

  return { cable, movers, beads: movers.map((m) => m.parentElement!) };
}

test("every rail gets a cable, but only the moving ones carry a charge", async () => {
  const { container } = await mount("full", [PV, GRID]);

  expect(container.querySelectorAll("path[id]")).toHaveLength(3);
  expect(charge(container, PV.d).movers).toHaveLength(BEAD_COUNT);
  expect(charge(container, GRID.d).movers).toHaveLength(BEAD_COUNT);
  expect(charge(container, IDLE.d).movers).toHaveLength(0);
});

test("the charge flies toward the hub on an inbound rail and away on an outbound one", async () => {
  const { container } = await mount("full", [PV, GRID]);

  for (const m of charge(container, PV.d).movers) expect(m.getAttribute("keyPoints")).toBe("0;1");

  for (const m of charge(container, GRID.d).movers) expect(m.getAttribute("keyPoints")).toBe("1;0");
});

test("a busier rail crosses faster, at exactly the crossing time the pulse decided", async () => {
  const { container } = await mount("full", [PV, GRID]);

  const dur = (d: string) => charge(container, d).movers[0]!.getAttribute("dur");
  expect(dur(PV.d)).toBe(`${PV.pulse.dur}s`);
  expect(dur(GRID.d)).toBe(`${GRID.pulse.dur}s`);
  expect(GRID.pulse.dur).toBeLessThan(PV.pulse.dur);
});

test("a sample that keeps the crossing time keeps the running charge", async () => {
  const { container, rerender } = await mount("full", [PV]);
  const before = charge(container, PV.d).beads[0];

  // A 1 Hz wobble: a new pulse object, the same quantized duration.
  const wobble = rail("pv", "in", 3010, 20);
  expect(wobble.pulse.dur).toBe(PV.pulse.dur);
  await rerender({ flowing: [wobble], lines: [wobble, GRID, IDLE] });
  expect(charge(container, PV.d).beads[0]).toBe(before);

  // A step in the duration rebuilds the chain instead of remapping it.
  const surge = rail("pv", "in", 8000, 20);
  await rerender({ flowing: [surge], lines: [surge, GRID, IDLE] });
  await expect.poll(() => charge(container, PV.d).beads[0]).not.toBe(before);
  expect(charge(container, PV.d).movers[0]!.getAttribute("dur")).toBe(`${surge.pulse.dur}s`);
});

test("a rail that reverses is replaced, not mirrored in place", async () => {
  const { container, rerender } = await mount("full", [PV]);
  const before = charge(container, PV.d).beads[0];

  const reversed = rail("pv", "out", 3000, 20);
  await rerender({ flowing: [reversed], lines: [reversed, GRID, IDLE] });

  // The old chain fades out beside the new one, then leaves.
  await finish(() => !before!.isConnected);
  const after = charge(container, PV.d).movers;
  expect(after).toHaveLength(BEAD_COUNT);

  for (const m of after) expect(m.getAttribute("keyPoints")).toBe("1;0");
});

test("the lite tier draws one travelling dash per rail, in the flow's direction", async () => {
  const { container } = await mount("lite", [PV, GRID]);

  expect(container.querySelectorAll("animateMotion")).toHaveLength(0);
  const overlays = [...container.querySelectorAll("path:not([id])")];
  expect(overlays).toHaveLength(2);

  const style = (d: string) => getComputedStyle(overlays.find((p) => p.getAttribute("d") === d)!);
  expect(style(PV.d).animationName).toMatch(/flow-dash$/u);
  expect(style(PV.d).animationDirection).toBe("normal");
  expect(style(GRID.d).animationDirection).toBe("reverse");
  expect(style(GRID.d).animationDuration).toBe(`${GRID.pulse.dur}s`);
});

test("the still tier moves nothing but still states each rail's magnitude", async () => {
  const { container } = await mount("still", [PV, GRID]);

  expect(container.querySelectorAll("animateMotion")).toHaveLength(0);
  const overlays = [...container.querySelectorAll("path:not([id])")];
  expect(overlays).toHaveLength(2);

  for (const p of overlays) expect(getComputedStyle(p).animationName).toBe("none");

  const width = (d: string) =>
    Number(overlays.find((p) => p.getAttribute("d") === d)!.getAttribute("stroke-width"));

  expect(width(PV.d)).toBe(PV.pulse.width);
  expect(width(GRID.d)).toBeGreaterThan(width(PV.d));
});
