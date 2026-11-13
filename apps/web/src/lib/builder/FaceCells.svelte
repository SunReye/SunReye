<!--
  A face's cells (ADR 20): a tap toggles one cell, and a drag paints or erases along the pointer's
  path as one undo step, by mouse, pen or touch. A refused paint answers in place.
-->
<script lang="ts" module>
  export type { Checks } from "./checks.ts";
</script>

<script lang="ts">
  import { haptics } from "../haptics.ts";
  import { m } from "../paraglide/messages.js";
  import Refusal from "../setup/Refusal.svelte";
  import {
    apply,
    paint,
    refuses,
    strokeOf,
    type At,
    type Draft,
    type Stroke,
    type Strokes,
    type Tool,
  } from "./modules.ts";
  import { misplacedText, type Checks } from "./checks.ts";
  import type { Cell, CellPlace, ModuleGrid, RoofFace } from "./pv.ts";
  import { stringCss } from "./scene.ts";

  let {
    draft,
    index,
    grid,
    roof,
    cells,
    checks,
    tool,
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
    checks: Checks;
    tool: Tool;
    /** Where a drag's steps go: shown at once, recorded once let go. */
    strokes: Strokes;
    onchange: (draft: Draft) => void;
  } = $props();

  /** The face's extent across and up the slope, in metres. */
  const across = $derived(Math.max(0.1, ...roof.outline.map(([u]) => u)));

  const up = $derived(Math.max(0.1, ...roof.outline.map(([, v]) => v)));

  function percent(length: number, of: number): string {
    return `${(100 * length) / of}%`;
  }

  /** An area of the face's outline, placed on the drawn face. */
  function placed([[left, bottom], [right, top]]: CellPlace["area"]): string {
    return [
      `left: ${percent(left, across)}`,
      `bottom: ${percent(bottom, up)}`,
      `width: ${percent(right - left, across)}`,
      `height: ${percent(top - bottom, up)}`,
    ].join("; ");
  }

  /** The module placed in a cell, if any. */
  function moduleIn({ row, column }: At): Cell | undefined {
    return grid.modules.find((c) => c.row === row && c.column === column);
  }

  function cellClass(module: Cell | undefined): (string | false)[] {
    return ["cell", coldHere.some(({ string }) => module?.string === string) && "cold"];
  }

  function cellStyle(cell: CellPlace, module: Cell | undefined): string {
    const fill = module === undefined ? "" : `; background: ${stringCss(module.string)}`;

    return `${placed(cell.area)}${fill}`;
  }

  /** A pointer's press painted already; the keyboard taps here. */
  function tap(event: MouseEvent, cell: CellPlace): void {
    if (event.detail === 0 && !refused()) {
      onchange({ ...draft, scene: apply(draft.scene, index, cell, tool) });
    }
  }

  /** The strings painted here that are too high in the cold. */
  const coldHere = $derived(
    checks.cold.filter(({ string }) => grid.modules.some((cell) => cell.string === string)),
  );

  /** Where the refused module lies, even past the face's edge. */
  const misplaced = $derived(checks.misplaced);

  const stray = $derived(
    misplaced !== null && "area" in misplaced && misplaced.area !== null
      ? { area: misplaced.area, label: misplacedText(misplaced) }
      : null,
  );

  /** Why the last press was refused, until the next one. */
  let refusal = $state<string>();

  /** The drag under way: its pointer, its stroke and the last cell it crossed. */
  let held: { pointer: number; stroke: Stroke; last: string } | undefined;

  /** The cell under a page point, if any. */
  function cellAt(x: number, y: number): At | undefined {
    const found = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-row]");

    if (found === null || found === undefined) return undefined;

    return { row: Number(found.dataset["row"]), column: Number(found.dataset["column"]) };
  }

  function refused(): boolean {
    const string = tool.kind === "paint" ? tool.string : undefined;

    refusal =
      string !== undefined && refuses(draft, index, tool)
        ? m.builder_refused_module_type({ name: draft.strings[string]?.name ?? "" })
        : undefined;

    if (refusal !== undefined) haptics.error();

    return refusal !== undefined;
  }

  function press(event: PointerEvent & { currentTarget: HTMLElement }): void {
    const at = cellAt(event.clientX, event.clientY);

    if (held !== undefined || event.button !== 0 || at === undefined || refused()) return;

    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);

    const stroke = strokeOf(draft.scene, index, at, tool);

    held = { pointer: event.pointerId, stroke, last: `${at.row}.${at.column}` };
    strokes.drag(paint(draft.scene, index, at, stroke));
  }

  function move(event: PointerEvent): void {
    if (held?.pointer !== event.pointerId) return;

    const at = cellAt(event.clientX, event.clientY);
    const key = at === undefined ? held.last : `${at.row}.${at.column}`;

    if (at === undefined || key === held.last) return;

    held.last = key;
    strokes.drag(paint(draft.scene, index, at, held.stroke));
  }

  function release(event: PointerEvent): void {
    if (held?.pointer !== event.pointerId) return;

    held = undefined;
    strokes.drop();
  }
</script>

<div
  class="face"
  role="group"
  aria-label={m.builder_cells()}
  style:aspect-ratio={`${across} / ${up}`}
  onpointerdown={press}
  onpointermove={move}
  onpointerup={release}
  onpointercancel={release}
>
  <svg viewBox="0 0 {across} {up}" preserveAspectRatio="none" aria-hidden="true">
    <polygon points={roof.outline.map(([u, v]) => `${u},${up - v}`).join(" ")} />
  </svg>
  {#each cells as cell (`${cell.row}.${cell.column}`)}
    {@const module = moduleIn(cell)}
    <button
      type="button"
      class={cellClass(module)}
      aria-label={m.builder_cell({ row: cell.row + 1, column: cell.column + 1 })}
      aria-pressed={module !== undefined}
      data-row={cell.row}
      data-column={cell.column}
      style={cellStyle(cell, module)}
      onclick={(event) => {
        tap(event, cell);
      }}>{module?.optimized ? "◆" : ""}</button
    >
  {/each}
  {#if stray !== null}
    <span class="stray" role="img" aria-label={stray.label} style={placed(stray.area)}></span>
  {/if}
</div>
{#each coldHere as warning (warning.string)}
  <p role="status" class="px-3 pb-2 text-sm text-warning">{warning.text}</p>
{/each}
{#if refusal !== undefined}
  <div class="px-3 pb-3"><Refusal text={refusal} /></div>
{/if}

<style>
  .face {
    position: relative;
    touch-action: none;
    user-select: none;
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

  /* Over its inverter's limit in the cold: a warning, never a refusal (ADR 20). */
  .cell.cold {
    box-shadow: inset 0 0 0 2px var(--warning);
  }

  /* A module the core would refuse, where it lies, even past the face's edge. */
  .stray {
    position: absolute;
    border: 2px dashed var(--destructive);
    border-radius: 1px;
    background: color-mix(in oklch, var(--destructive) 18%, transparent);
    pointer-events: none;
  }
</style>
