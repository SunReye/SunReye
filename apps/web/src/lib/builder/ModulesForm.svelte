<script lang="ts">
  import type { ModuleType } from "../api/core.ts";
  import { m } from "../paraglide/messages.js";
  import FaceGrid from "./FaceGrid.svelte";
  import { addGrid, type Draft } from "./modules.ts";
  import type { Modules } from "./pv.ts";
  import StringsForm from "./StringsForm.svelte";

  let {
    draft,
    laid,
    moduleTypes,
    onchange,
  }: {
    draft: Draft;
    /** The crate's layout of `draft.scene`'s grids. */
    laid: Modules;
    moduleTypes: readonly ModuleType[];
    onchange: (draft: Draft) => void;
  } = $props();

  let chosen = $state(0);

  const roof = $derived(laid.roofs[chosen] ?? laid.roofs[0]);

  const index = $derived(
    (draft.scene.grids ?? []).findIndex(
      (grid) => grid.block === roof?.block && grid.face === roof.face,
    ),
  );

  const grid = $derived(draft.scene.grids?.[index]);

  const unassigned = $derived(
    (draft.scene.grids ?? []).flatMap((g) =>
      g.modules.filter((cell) => (cell.string ?? undefined) === undefined),
    ).length,
  );

  /** The face's own module type for a new grid or string, else the first. */
  const moduleType = $derived(grid?.moduleType ?? moduleTypes[0]?.id);
</script>

<section>
  <h2>{m.builder_modules()}</h2>
  {#if moduleType === undefined}
    <p>{m.builder_no_module_types()}</p>
  {/if}

  <label>
    {m.builder_face()}
    <select
      value={chosen}
      onchange={(event) => {
        chosen = Number(event.currentTarget.value);
      }}
    >
      {#each laid.roofs as face, i (`${face.block}.${face.face}`)}
        <option value={i}
          >{m.builder_face_option({
            block: face.block + 1,
            face: face.face + 1,
            azimuth: Math.round(face.azimuth),
            tilt: Math.round(face.tilt),
          })}</option
        >
      {/each}
    </select>
  </label>

  {#if grid !== undefined && roof !== undefined}
    <FaceGrid
      {draft}
      {index}
      {grid}
      {roof}
      cells={laid.grids[index] ?? []}
      {moduleTypes}
      {onchange}
    />
  {:else if roof !== undefined && moduleType !== undefined}
    <button
      type="button"
      onclick={() => {
        onchange({ ...draft, scene: addGrid(draft.scene, roof.block, roof.face, moduleType) });
      }}>{m.builder_add_grid()}</button
    >
  {/if}
  {#if unassigned > 0}
    <p>{m.builder_unassigned({ count: unassigned })}</p>
  {/if}

  <StringsForm {draft} {moduleTypes} {moduleType} {onchange} />
</section>

<style>
  section {
    display: grid;
    gap: 0.75rem;
    align-content: start;
  }
</style>
