import { expect, test } from "bun:test";
import { copies, RULES } from "./one-owner.ts";

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

test("the builder and the range own haptics by named file, not by folder", () => {
  const source = `import { haptics } from "../haptics.ts";`;
  const rule = "haptics outside a shared component";

  expect(rules("builder/wall-actions.ts", source)).toEqual([rule]);
  expect(rules("builder/BuildingLevel.svelte", source)).toEqual([rule]);
  expect(rules("range/Label.svelte", source)).toEqual([rule]);
  expect(rules("builder/gestures.ts", source)).toEqual([]);
});

test("a chart's pointer is read by named files alone: a drag elsewhere in the builder is a copy", () => {
  const rule = "pointer reading outside the one pointer reading";

  expect(rules("builder/View.svelte", `<div onpointerdown={down}>`)).toEqual([rule]);
  expect(rules("components/segmented.svelte", `<div onpointermove={move}>`)).toEqual([rule]);
  expect(rules("builder/drawing.svelte.ts", `onpointermove: move,`)).toEqual([]);
  expect(rules("components/value-editor/wheel.svelte", `<div onpointerdown={down}>`)).toEqual([]);
});

test("every owner of every rule says why it owns the behaviour", () => {
  for (const rule of RULES)
    for (const [owner, why] of Object.entries(rule.owners))
      expect({ owner, why: why.trim().length > 10 }).toEqual({ owner, why: true });
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

test("a chart read by its own pointer handlers or LayerChart's tooltip is a copy", () => {
  const rule = "pointer reading outside the one pointer reading";

  expect(rules("history/Trend.svelte", `<div onpointermove={point}>`)).toEqual([rule]);
  expect(rules("analytics/Heat.svelte", `<div\n  onpointerdown={(e) => {}}>`)).toEqual([rule]);
  expect(rules("live/Plot.ts", `el.addEventListener("pointermove", read);`)).toEqual([rule]);
  expect(rules("history/Trend.svelte", `tooltipContext={{ mode: "bisect-x" }}`)).toEqual([rule]);
  expect(rules("history/Trend.svelte", `<div {...reading.on}>`)).toEqual([]);
  expect(rules("chart-reading/reader.svelte.ts", `onpointermove: this.move,`)).toEqual([]);
  // Drags that read no chart.
  expect(rules("range/pager-drag.ts", `addEventListener("pointermove", move)`)).toEqual([]);
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

test("the haptics library or the vibration API anywhere in the app is a copy: the module is the kit's", () => {
  const rule = "haptics library outside the haptics module";

  expect(rules("tariff/Zone.svelte", `import { WebHaptics } from "web-haptics";`)).toEqual([rule]);
  expect(rules("builder/gestures.ts", `navigator.vibrate(10);`)).toEqual([rule]);
  expect(rules("haptics.ts", `import { WebHaptics } from "web-haptics";`)).toEqual([rule]);
});

test("toggle groups or tabs straight from bits-ui outside the kit are a copy", () => {
  const rule = "bits-ui choice outside the kit";

  expect(rules("tariff/Zone.svelte", `import { ToggleGroup } from "bits-ui";`)).toEqual([rule]);
  expect(rules("tariff/Zone.svelte", `import {\n  Popover,\n  Tabs,\n} from "bits-ui";`)).toEqual([
    rule,
  ]);
  expect(
    rules("components/value-editor/value-editor.svelte", `import { Popover } from "bits-ui";`),
  ).toEqual([]);
  expect(rules("components/ui/tabs/tabs.svelte", `import { Tabs } from "bits-ui";`)).toEqual([]);
});

test("a card built by hand on any element but the kit card is a copy", () => {
  const rule = "card outside the kit card";

  expect(rules("tariff/Zone.svelte", `<div class="rounded-xl border p-4">`)).toEqual([rule]);
  expect(rules("tariff/Zone.svelte", `<section\n  class="bg-card rounded-xl">`)).toEqual([rule]);
  // A rounded image or a bordered row is no card.
  expect(rules("tariff/Zone.svelte", `<img class="rounded-xl" />`)).toEqual([]);
  expect(rules("tariff/Zone.svelte", `<div class="rounded-xl border-t">`)).toEqual([]);
  expect(rules("tariff/Zone.svelte", `<Card.Root class="rounded-xl border">`)).toEqual([]);
});

test("a literal motion duration or easing outside the motion tokens is a copy", () => {
  const rule = "motion value outside the motion tokens";

  expect(rules("flow/Hub.svelte", `<div class="transition-opacity duration-300">`)).toEqual([rule]);
  expect(rules("flow/Hub.svelte", `<div class="transition ease-in-out">`)).toEqual([rule]);
  expect(
    rules(
      "flow/Hub.svelte",
      `<style>\n  .a {\n    transition: opacity 4s steps(4);\n  }\n</style>`,
    ),
  ).toEqual([rule]);
  expect(
    rules(
      "flow/Hub.svelte",
      `<style>\n  .a {\n    animation: beat var(--motion-flow-pulse) ease-in-out infinite;\n  }\n</style>`,
    ),
  ).toEqual([rule]);
  // The tokens, and words that only look like them.
  expect(
    rules("flow/Hub.svelte", `<div class="duration-(--motion-move) ease-(--motion-ease-in-out)">`),
  ).toEqual([]);
  expect(
    rules(
      "flow/Hub.svelte",
      `<style>\n  .a {\n    transition: opacity var(--motion-base) var(--motion-ease);\n  }\n</style>`,
    ),
  ).toEqual([]);
  expect(rules("flow/Hub.svelte", `// A slide eases in-out: ease-in-out\nconst ms = 300;`)).toEqual(
    [],
  );
  expect(rules("motion/ease.ts", `const curve = "ease-in-out";`)).toEqual([]);
});

test("the glass card the kit card replaced is a copy wherever it comes back", () => {
  expect(
    rules("history/Notes.svelte", `import GlassCard from "../components/glass-card.svelte";`),
  ).toEqual(["glass card outside the kit card"]);
  expect(rules("components/ui/card/card.svelte", `<GlassCard>`)).toEqual([
    "glass card outside the kit card",
  ]);
});

test("ambient glass is the kit card's own look: named on a card or anything else, a copy", () => {
  const rule = "glass surface outside the kit card";

  expect(rules("history/Notes.svelte", `<Card.Root class="glass-ambient gap-0 py-0">`)).toEqual([
    rule,
  ]);
  expect(
    copies(
      `${LIB}tariff/Form.svelte`,
      `<Card.Root class="gap-0">\n</Card.Root>\n<div\n  class="glass-ambient p-2">`,
    ),
  ).toEqual([{ rule, line: 4 }]);
  expect(
    rules(
      "explore/Screen.svelte",
      `<script>\n  const look = { card: "glass-ambient" };\n</script>`,
    ),
  ).toEqual([rule]);
  expect(rules("components/ui/card/card.svelte", `const glassy = "glass-ambient";`)).toEqual([]);
});

test("the shell's surfaces, the sheets and the kit own their glass", () => {
  const bar = `<nav class="glass-sidebar glass-ambient fixed">`;

  expect(rules("shell/Bar.svelte", bar)).toEqual([]);
  expect(rules("components/drawer-sheet.svelte", bar)).toEqual([]);
  expect(rules("components/ui/sonner/sonner.svelte", `toast: "glass-ambient!"`)).toEqual([]);
});

test("a pulse or a spin that reduced motion does not stop is a copy", () => {
  const rule = "animation reduced motion does not stop";

  expect(rules("setup/List.svelte", `<div class="h-12 animate-pulse rounded-md"></div>`)).toEqual([
    rule,
  ]);
  expect(
    rules("components/ui/sonner/sonner.svelte", `<Loader class="size-4 animate-spin" />`),
  ).toEqual([rule]);
  expect(rules("setup/Scan.svelte", `<Loader class="motion-safe:animate-spin" />`)).toEqual([]);
  expect(
    rules("range/Chart.svelte", `<div class="flex animate-pulse motion-reduce:animate-none">`),
  ).toEqual([]);
  expect(
    rules("range/Label.svelte", `class="size-1.5 animate-pulse-dot motion-reduce:animate-none"`),
  ).toEqual([]);
  // Only its own class string stops it.
  expect(
    rules(
      "setup/List.svelte",
      `<p class="motion-reduce:animate-none"></p>\n<div class="animate-pulse"></div>`,
    ),
  ).toEqual([rule]);
});

test("a comment that names a pulse or the glass is no copy", () => {
  expect(
    rules("setup/List.svelte", `// Local: the pulse stops, as animate-pulse does not.`),
  ).toEqual([]);
  expect(rules("setup/List.svelte", `<!-- not glass-ambient: a card -->`)).toEqual([]);
});

test("a link styled by hand, or the kit's link button, is a copy of the text link", () => {
  const rule = "link outside the text link";

  expect(
    rules("settings/Tokens.svelte", `<a class="text-brand hover:underline" href="#/api">`),
  ).toEqual([rule]);
  expect(rules("settings/Motion.svelte", `<Button variant="link" onclick={go}>`)).toEqual([rule]);
  expect(rules("components/text-link.svelte", `"text-brand hover:underline"`)).toEqual([]);
});

test("a radio pick outside the select field and the named menus is a copy", () => {
  const menu = `<DropdownMenu.RadioGroup bind:value>`;
  const radios = `import * as RadioGroup from "../components/ui/radio-group/index.js";`;

  expect(rules("settings/ImportDevice.svelte", menu)).toEqual([
    "pick list outside the select field",
  ]);
  expect(rules("forecast/LinePicker.svelte", `<Menubar.RadioGroup>`)).toEqual([
    "pick list outside the select field",
  ]);
  expect(rules("setup/MoveField.svelte", radios)).toEqual(["pick list outside the select field"]);
  expect(rules("components/select-field.svelte", menu)).toEqual([]);
  expect(rules("gallery/sections/Choices.svelte", radios)).toEqual([]);
  // A canvas toolbar's menu, not a form.
  expect(rules("builder/WeatherMenu.svelte", menu)).toEqual([]);
});

test("a range control outside a screen's header or a sheet's head is a copy", () => {
  const source = `import RangeControl from "../range/RangeControl.svelte";`;
  const rule = "range control outside a header";

  expect(rules("tariff/TariffScreen.svelte", source)).toEqual([rule]);
  expect(rules("range/RangeScreen.svelte", source)).toEqual([]);
  expect(rules("detail/Analytics.svelte", source)).toEqual([]);
});

test("a card's presence transition outside the kit card is a copy", () => {
  const source = `import { presence } from "#lib/components/ui/card/presence.ts";`;
  const wrapper = `import { Presence } from "#lib/components/ui/card/index.js";`;

  expect(rules("history/Aside.svelte", source)).toEqual(["card presence outside the kit card"]);
  expect(rules("components/ui/card/card-presence.svelte", source)).toEqual([]);
  expect(rules("history/Aside.svelte", wrapper)).toEqual([]);
});
