<!--
  A face's module-grid editor (ADR 20): its settings, "Fläche füllen" and "Fläche leeren". The modules
  themselves are laid on the roof in 3D while the face is selected.
-->
<script lang="ts">
  import Grid2x2Plus from "@lucide/svelte/icons/grid-2x2-plus";
  import Grid2x2X from "@lucide/svelte/icons/grid-2x2-x";
  import type { ModuleType } from "../api/core.ts";
  import { m } from "../paraglide/messages.js";
  import { Button } from "#lib/components/ui/button/index.js";
  import type { Checks } from "./checks.ts";
  import GridSettings from "./GridSettings.svelte";
  import { clearGrid, editGrid, fillGrid, removeGrid, type Draft } from "./modules.ts";
  import type { ModuleGrid } from "./pv.ts";

  let {
    draft,
    index,
    grid,
    free,
    checks,
    moduleTypes,
    onchange,
  }: {
    draft: Draft;
    /** The grid's position in the scene. */
    index: number;
    grid: ModuleGrid;
    /** The places "Fläche füllen" adds, as the crate finds them on the free roof. */
    free: readonly (readonly [number, number])[];
    checks: Checks;
    moduleTypes: readonly ModuleType[];
    onchange: (draft: Draft) => void;
  } = $props();

  /** The strings painted here that are too high in the cold. */
  const coldHere = $derived(
    checks.cold.filter(({ string }) => grid.modules.some((module) => module.string === string)),
  );
</script>

<GridSettings
  {grid}
  {moduleTypes}
  onedit={(fields) => {
    onchange({ ...draft, scene: editGrid(draft.scene, index, fields) });
  }}
/>

<div class="flex flex-col gap-2 border-t border-border/60 p-3">
  <p role="status" class="text-sm tabular-nums">
    {m.builder_face_count({ placed: grid.modules.length })}
  </p>
  <p class="text-sm text-muted-foreground">{m.builder_face_hint()}</p>
  <div class="grid grid-cols-2 gap-2">
    <Button
      variant="outline"
      size="sm"
      disabled={free.length === 0}
      onclick={() => {
        onchange({ ...draft, scene: fillGrid(draft.scene, index, free) });
      }}
    >
      <Grid2x2Plus data-icon="inline-start" />
      {m.builder_fill_face()}
    </Button>
    <Button
      variant="outline"
      size="sm"
      disabled={grid.modules.length === 0}
      onclick={() => {
        onchange({ ...draft, scene: clearGrid(draft.scene, index) });
      }}
    >
      <Grid2x2X data-icon="inline-start" />
      {m.builder_clear_face()}
    </Button>
  </div>
  {#each coldHere as warning (warning.string)}
    <p role="status" class="text-sm text-warning">{warning.text}</p>
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
