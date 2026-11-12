<script lang="ts">
  import type { ModuleType } from "../api/core.ts";
  import { m } from "../paraglide/messages.js";
  import { Button } from "#lib/components/ui/button/index.js";
  import * as ToggleGroup from "#lib/components/ui/toggle-group/index.js";
  import GridSettings from "./GridSettings.svelte";
  import { apply, editGrid, removeGrid, type Draft, type Tool } from "./modules.ts";
  import type { CellPlace, ModuleGrid, RoofFace } from "./pv.ts";
  import { stringCss } from "./scene.ts";

  let {
    draft,
    index,
    grid,
    roof,
    cells,
    moduleTypes,
    onchange,
  }: {
    draft: Draft;
    /** The grid's position in the scene. */
    index: number;
    grid: ModuleGrid;
    roof: RoofFace;
    /** Every cell the setback holds, as the crate lays them out. */
    cells: readonly CellPlace[];
    moduleTypes: readonly ModuleType[];
    onchange: (draft: Draft) => void;
  } = $props();

  const uid = $props.id();

  let tool = $state.raw<Tool>({ kind: "place" });

  /** The face's extent across and up the slope, in metres. */
  const across = $derived(Math.max(0.1, ...roof.outline.map(([u]) => u)));

  const up = $derived(Math.max(0.1, ...roof.outline.map(([, v]) => v)));

  const tools = $derived<readonly (readonly [Tool, string])[]>([
    [{ kind: "place" }, m.tool_place()],
    [{ kind: "optimizer" }, m.tool_optimizer()],
    [{ kind: "paint" }, m.tool_unassign()],
    ...draft.strings.map(
      (string, i) => [{ kind: "paint", string: i }, m.tool_paint({ name: string.name })] as const,
    ),
  ]);

  function percent(length: number, of: number): string {
    return `${(100 * length) / of}%`;
  }

  /** A tool as a toggle's value. */
  function toolKey(option: Tool): string {
    return option.kind === "paint" ? `paint:${String(option.string ?? "")}` : option.kind;
  }

  function choose(key: string): void {
    const found = tools.find(([option]) => toolKey(option) === key);

    if (found !== undefined) tool = found[0];
  }
</script>

<GridSettings
  {grid}
  {moduleTypes}
  onedit={(fields) => {
    onchange({ ...draft, scene: editGrid(draft.scene, index, fields) });
  }}
/>

<div class="flex flex-col gap-2 border-t border-border/60 p-3">
  <span id="{uid}-tool" class="text-xs font-medium text-muted-foreground">{m.builder_tool()}</span>
  <ToggleGroup.Root
    type="single"
    size="sm"
    spacing={1}
    aria-labelledby="{uid}-tool"
    class="flex-wrap justify-start"
    bind:value={() => toolKey(tool), choose}
  >
    {#each tools as [option, label] (label)}
      <ToggleGroup.Item value={toolKey(option)} class="px-2.5 text-xs">
        {#if option.kind === "paint"}
          <span class="size-2.5 rounded-sm" style:background={stringCss(option.string)}></span>
        {/if}
        {label}
      </ToggleGroup.Item>
    {/each}
  </ToggleGroup.Root>
</div>

<div
  class="face"
  role="group"
  aria-label={m.builder_cells()}
  style:aspect-ratio={`${across} / ${up}`}
>
  <svg viewBox="0 0 {across} {up}" preserveAspectRatio="none" aria-hidden="true">
    <polygon points={roof.outline.map(([u, v]) => `${u},${up - v}`).join(" ")} />
  </svg>
  {#each cells as cell (`${cell.row}.${cell.column}`)}
    {@const module = grid.modules.find((c) => c.row === cell.row && c.column === cell.column)}
    {@const [[left, bottom], [right, top]] = cell.area}
    <button
      type="button"
      class="cell"
      aria-label={m.builder_cell({ row: cell.row + 1, column: cell.column + 1 })}
      aria-pressed={module !== undefined}
      style:left={percent(left, across)}
      style:bottom={percent(bottom, up)}
      style:width={percent(right - left, across)}
      style:height={percent(top - bottom, up)}
      style:background={module === undefined ? undefined : stringCss(module.string)}
      onclick={() => {
        onchange({ ...draft, scene: apply(draft.scene, index, cell, tool) });
      }}>{module?.optimized === true ? "◆" : ""}</button
    >
  {/each}
</div>

<div class="border-t border-border/60 p-3">
  <Button
    variant="destructive"
    class="w-full"
    onclick={() => {
      onchange({ ...draft, scene: removeGrid(draft.scene, index) });
    }}>{m.builder_remove_grid()}</Button
  >
</div>

<style>
  .face {
    position: relative;
    width: calc(100% - 1.5rem);
    margin: 0.75rem;
  }

  svg {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
  }

  polygon {
    fill: color-mix(in oklch, var(--muted-foreground) 12%, transparent);
    stroke: var(--muted-foreground);
    stroke-width: 0.03;
  }

  .cell {
    position: absolute;
    padding: 0;
    border: 1px dashed var(--border);
    border-radius: 1px;
    background: transparent;
    color: #fff;
    font-size: 0.75rem;
  }

  .cell:hover {
    border-color: var(--muted-foreground);
  }

  .cell[aria-pressed="true"] {
    border-style: solid;
  }
</style>
