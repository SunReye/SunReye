<!-- A face's module-grid editor (ADR 20): its settings, the tool, "Fläche füllen" and the cells. -->
<script lang="ts">
  import Grid2x2Plus from "@lucide/svelte/icons/grid-2x2-plus";
  import type { ModuleType } from "../api/core.ts";
  import { m } from "../paraglide/messages.js";
  import { Button } from "#lib/components/ui/button/index.js";
  import * as ToggleGroup from "#lib/components/ui/toggle-group/index.js";
  import FaceCells from "./FaceCells.svelte";
  import GridSettings from "./GridSettings.svelte";
  import {
    editGrid,
    fillGrid,
    removeGrid,
    type Draft,
    type Strokes,
    type Tool,
  } from "./modules.ts";
  import type { CellPlace, ModuleGrid, RoofFace } from "./pv.ts";
  import { stringCss } from "./scene.ts";

  let {
    draft,
    index,
    grid,
    roof,
    cells,
    moduleTypes,
    strokes,
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
    /** Where a drag's steps go: shown at once, recorded once let go. */
    strokes: Strokes;
    onchange: (draft: Draft) => void;
  } = $props();

  const uid = $props.id();

  let tool = $state.raw<Tool>({ kind: "place" });

  const tools = $derived<readonly (readonly [Tool, string])[]>([
    [{ kind: "place" }, m.tool_place()],
    [{ kind: "optimizer" }, m.tool_optimizer()],
    [{ kind: "paint" }, m.tool_unassign()],
    ...draft.strings.map(
      (string, i) => [{ kind: "paint", string: i }, m.tool_paint({ name: string.name })] as const,
    ),
  ]);

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
  <Button
    variant="outline"
    size="sm"
    class="justify-start"
    disabled={cells.length === 0}
    onclick={() => {
      onchange({ ...draft, scene: fillGrid(draft.scene, index, cells) });
    }}
  >
    <Grid2x2Plus data-icon="inline-start" />
    {m.builder_fill_face()}
  </Button>
</div>

<FaceCells {draft} {index} {grid} {roof} {cells} {tool} {strokes} {onchange} />

<div class="border-t border-border/60 p-3">
  <Button
    variant="destructive"
    class="w-full"
    onclick={() => {
      onchange({ ...draft, scene: removeGrid(draft.scene, index) });
    }}>{m.builder_remove_grid()}</Button
  >
</div>
