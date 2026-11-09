<script lang="ts">
  import type { ModuleType } from "../api/core.ts";
  import { m } from "../paraglide/messages.js";
  import ModuleTypeSelect from "./ModuleTypeSelect.svelte";
  import { apply, editGrid, removeGrid, type Draft, type Tool } from "./modules.ts";
  import NumberField from "./NumberField.svelte";
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

  function percent(metres: number, of: number): string {
    return `${(100 * metres) / of}%`;
  }

  function sameTool(a: Tool, b: Tool): boolean {
    return a.kind === b.kind && (a.kind !== "paint" || b.kind !== "paint" || a.string === b.string);
  }

  function edit(fields: Partial<Pick<ModuleGrid, "moduleType" | "landscape" | "setback">>): void {
    onchange({ ...draft, scene: editGrid(draft.scene, index, fields) });
  }
</script>

<fieldset class="settings">
  <ModuleTypeSelect
    value={grid.moduleType}
    {moduleTypes}
    onchange={(moduleType) => {
      edit({ moduleType });
    }}
  />
  <label>
    {m.builder_orientation()}
    <select
      value={grid.landscape ? "landscape" : "portrait"}
      onchange={(event) => {
        edit({ landscape: event.currentTarget.value === "landscape" });
      }}
    >
      <option value="portrait">{m.builder_portrait()}</option>
      <option value="landscape">{m.builder_landscape()}</option>
    </select>
  </label>
  <NumberField
    label={m.field_setback()}
    value={grid.setback}
    min={0}
    onchange={(setback) => {
      edit({ setback });
    }}
  />
  <button
    type="button"
    onclick={() => {
      onchange({ ...draft, scene: removeGrid(draft.scene, index) });
    }}>{m.builder_remove_grid()}</button
  >
</fieldset>

<fieldset class="tools">
  <legend>{m.builder_tool()}</legend>
  {#each tools as [option, label] (label)}
    <label>
      <input
        type="radio"
        name="tool"
        checked={sameTool(option, tool)}
        onchange={() => {
          tool = option;
        }}
      />
      {#if option.kind === "paint"}
        <span class="swatch" style:background={stringCss(option.string)}></span>
      {/if}
      {label}
    </label>
  {/each}
</fieldset>

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

<style>
  fieldset {
    display: grid;
    gap: 0.75rem;
  }

  .settings {
    grid-template-columns: repeat(auto-fill, minmax(8rem, 1fr));
    align-items: end;
  }

  .tools {
    grid-template-columns: repeat(auto-fill, minmax(10rem, 1fr));
  }

  .face {
    position: relative;
    width: 100%;
  }

  svg {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
  }

  polygon {
    fill: #9a4b3c33;
    stroke: #9a4b3c;
    stroke-width: 0.05;
  }

  .cell {
    position: absolute;
    padding: 0;
    border: 1px dashed #6b6f76;
    background: transparent;
    color: #fff;
    font-size: 0.75rem;
  }

  .cell[aria-pressed="true"] {
    border-style: solid;
  }

  .swatch {
    display: inline-block;
    width: 0.75rem;
    height: 0.75rem;
    border-radius: 2px;
  }
</style>
