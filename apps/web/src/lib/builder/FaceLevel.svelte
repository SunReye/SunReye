<!--
  A roof face's level (ADR 20): its module-grid editor or, before one, its module type. A type picked
  or entered here lays the grid at once.
-->
<script lang="ts">
  import type { Datasheet, ModuleType, Problem } from "../api/core.ts";
  import FaceGrid from "./FaceGrid.svelte";
  import { addGrid, type Draft, type Strokes } from "./modules.ts";
  import ModuleTypeForm from "./ModuleTypeForm.svelte";
  import ModuleTypePicker from "./ModuleTypePicker.svelte";
  import type { Plan } from "./outline.ts";
  import type { RoofFace } from "./pv.ts";

  let {
    roof,
    plan,
    moduleTypes,
    addType,
    strokes,
    onchange,
  }: {
    roof: RoofFace;
    plan: Plan;
    moduleTypes: readonly ModuleType[];
    /** Adds a module type to the core. */
    addType: (datasheet: Readonly<Datasheet>) => Promise<ModuleType | Problem>;
    strokes: Strokes;
    onchange: (draft: Draft) => void;
  } = $props();

  const draft = $derived(plan.draft);

  const index = $derived(
    (draft.scene.grids ?? []).findIndex((g) => g.block === roof.block && g.face === roof.face),
  );

  /** Whether the new module type's form shows instead of the types. */
  let entering = $state(false);

  function lay(moduleType: number): void {
    onchange({ ...draft, scene: addGrid(draft.scene, roof.block, roof.face, moduleType) });
  }
</script>

{#if draft.scene.grids?.[index] !== undefined}
  <FaceGrid
    {draft}
    {index}
    grid={draft.scene.grids[index]}
    {roof}
    cells={plan.laid.grids[index] ?? []}
    checks={{
      misplaced: plan.laid.misplaced?.grid === index ? plan.laid.misplaced : null,
      cold: plan.cold,
    }}
    {moduleTypes}
    {strokes}
    {onchange}
  />
{:else if entering}
  <ModuleTypeForm
    add={addType}
    onadded={({ id }) => {
      entering = false;
      lay(id);
    }}
    oncancel={() => {
      entering = false;
    }}
  />
{:else}
  <ModuleTypePicker
    {moduleTypes}
    onpick={lay}
    onnew={() => {
      entering = true;
    }}
  />
{/if}
