import { expect, test } from "bun:test";
import { covered, nativeControls } from "./native-controls.ts";

const elements = (source: string) => nativeControls(source).map((found) => found.element);

test("a native select, table or bare button is found, with its line", () => {
  expect(nativeControls(`<div>\n  <select><option>a</option></select>\n</div>`)).toEqual([
    { element: "select", line: 2 },
  ]);
  expect(elements(`<table><tr><td>1</td></tr></table>`)).toEqual(["table"]);
  expect(elements(`<button onclick={() => go()}>Go</button>`)).toEqual(["button"]);
});

test("an input is found by its type: date, time, datetime-local, range, color and file", () => {
  for (const type of ["date", "time", "datetime-local", "range", "color", "file"]) {
    expect(elements(`<input\n  onchange={(e) => pick(e)}\n  type="${type}"\n/>`)).toEqual([
      `input type="${type}"`,
    ]);
  }

  expect(elements(`<input type="text" /><input type="radio" /><input />`)).toEqual([]);
});

test("kit components, scripts, styles and comments are no finding", () => {
  const source = [
    `<script lang="ts">`,
    `  const markup = "<button>";`,
    `</script>`,
    `<!-- a native <select> was here -->`,
    `<Button>Go</Button><Select.Root /><Table.Root />`,
    `<style>`,
    `  button { color: red; }`,
    `</style>`,
  ].join("\n");

  expect(nativeControls(source)).toEqual([]);
});

test("the rule covers every Svelte file of the SPA outside the kit", () => {
  expect(covered("apps/home/web/src/lib/range/CustomBounds.svelte")).toBe(true);
  expect(covered("apps/home/web/src/routes/+page.svelte")).toBe(true);
  expect(covered("apps/home/web/src/lib/components/ui/table/table.svelte")).toBe(false);
  expect(covered("apps/home/web/src/lib/range/range.ts")).toBe(false);
});

test("the rule covers the builder package's Svelte files too: it is drawn with the kit (ADR 25)", () => {
  expect(covered("packages/builder/src/builder/Builder.svelte")).toBe(true);
  expect(covered("packages/builder/src/scene/stage.svelte.ts")).toBe(false);
});
