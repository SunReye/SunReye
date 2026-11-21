import { expect, test } from "bun:test";
import { copies } from "./one-owner.ts";

const LIB = "apps/web/src/lib/";

const rules = (path: string, source: string) => copies(`${LIB}${path}`, source).map((f) => f.rule);

test("a toggle group outside the segmented control is a copy, with its line", () => {
  const source = `<script>\n  import * as ToggleGroup from "#lib/components/ui/toggle-group/index.js";\n</script>`;

  expect(copies(`${LIB}history/Compare.svelte`, source)).toEqual([
    { rule: "toggle group outside the segmented control", line: 2 },
  ]);
  expect(rules("components/segmented.svelte", source)).toEqual([]);
  expect(rules("components/ui/toggle-group/toggle-group.svelte", source)).toEqual([]);
});

test("a tabs list in any look but the segmented one is a copy", () => {
  expect(rules("detail/Days.svelte", `<Tabs.List variant="line">`)).toEqual([
    "tabs list not segmented",
  ]);
  expect(rules("detail/Days.svelte", `<Tabs.List\n  class="x">`)).toEqual([
    "tabs list not segmented",
  ]);
  expect(rules("detail/Days.svelte", `<Tabs.List variant="segmented" aria-label={l}>`)).toEqual([]);
});

test("haptics outside their owners is a copy", () => {
  const source = `import { haptics } from "../haptics.ts";`;

  expect(rules("tariff/Zone.svelte", source)).toEqual(["haptics outside a shared component"]);
  expect(rules("components/drawer-sheet.svelte", source)).toEqual([]);
  expect(rules("range/RangePane.svelte", source)).toEqual([]);
});

test("svelte's transitions outside the motion modules are a copy", () => {
  const source = `import { fade } from "svelte/transition";`;

  expect(rules("flow/FlowRails.svelte", source)).toEqual(["transition outside the motion modules"]);
  expect(rules("motion/slide.ts", source)).toEqual([]);
});

test("a chart without the chart entrance is a copy; a mark inside one is not", () => {
  const chart = `<script>\n  import { Chart, Svg } from "layerchart";\n</script>\n<Chart />`;

  expect(rules("history/Trend.svelte", chart)).toEqual(["chart without the chart entrance"]);
  expect(rules("history/Trend.svelte", `${chart}\n<ChartEntrance build="draw" />`)).toEqual([]);
  expect(rules("analytics/Heat.svelte", `<canvas></canvas>`)).toEqual([
    "chart without the chart entrance",
  ]);
  expect(rules("history/TrendMark.svelte", `import { Area } from "layerchart";`)).toEqual([]);
});

test("tests, harnesses and files outside the SPA are not held to it", () => {
  const source = `<Tabs.List variant="line">`;

  expect(rules("detail/Days.svelte.test.ts", source)).toEqual([]);
  expect(rules("detail/days.harness.svelte", source)).toEqual([]);
  expect(copies("scripts/x.ts", source)).toEqual([]);
});

test("haptics are found by any way of importing them", () => {
  for (const from of ["../haptics.js", "../haptics", "#lib/haptics.ts", "./haptics.ts"]) {
    expect(rules("tariff/Zone.svelte", `import { haptics } from "${from}";`)).toEqual([
      "haptics outside a shared component",
    ]);
  }
});

test("a chart that only names the entrance in a comment is still a copy", () => {
  const chart = `<!-- not yet in a ChartEntrance -->\n<canvas></canvas>`;

  expect(rules("analytics/Heat.svelte", chart)).toEqual(["chart without the chart entrance"]);
});

test("routes are held to it too", () => {
  expect(copies("apps/web/src/routes/x/+page.svelte", `<Tabs.List variant="line">`)).toEqual([
    { rule: "tabs list not segmented", line: 1 },
  ]);
});

test("the haptics library itself is no copy", () => {
  expect(rules("tariff/Zone.svelte", `import { WebHaptics } from "web-haptics";`)).toEqual([]);
});
