<!--
  A roof face's level (ADR 20): its module-grid editor or, before one, its module type. A type picked,
  copied from the module catalogue or entered here lays the grid at once.
-->
<script lang="ts">
  import type { ModuleType } from "../api/core.ts";
  import FaceGrid from "./FaceGrid.svelte";
  import ModuleCatalogue from "./ModuleCatalogue.svelte";
  import { addGrid, type Draft, type Strokes, type TypeSource } from "./modules.ts";
  import ModuleTypeForm from "./ModuleTypeForm.svelte";
  import ModuleTypePicker from "./ModuleTypePicker.svelte";
  import type { Plan } from "./outline.ts";
  import type { RoofFace } from "./pv.ts";

  let {
    roof,
    plan,
    moduleTypes,
    types,
    strokes,
    onchange,
  }: {
    roof: RoofFace;
    plan: Plan;
    moduleTypes: readonly ModuleType[];
    /** Adds module types to the core, and its catalogue to add them from. */
    types: TypeSource;
    strokes: Strokes;
    onchange: (draft: Draft) => void;
  } = $props();

  const draft = $derived(plan.draft);

  const index = $derived(
    (draft.scene.grids ?? []).findIndex((g) => g.block === roof.block && g.face === roof.face),
  );

  /** What shows instead of the types: the module catalogue or the new module type's form. */
  let adding = $state<"catalogue" | "form">();

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
{:else if adding === "catalogue"}
  <ModuleCatalogue
    {types}
    onadded={({ id }) => {
      adding = undefined;
      lay(id);
    }}
    oncancel={() => {
      adding = undefined;
    }}
  />
{:else if adding === "form"}
  <ModuleTypeForm
    add={(datasheet) => types.addModuleType(datasheet)}
    onadded={({ id }) => {
      adding = undefined;
      lay(id);
    }}
    oncancel={() => {
      adding = undefined;
    }}
  />
{:else}
  <ModuleTypePicker
    {moduleTypes}
    onpick={lay}
    oncatalogue={() => {
      adding = "catalogue";
    }}
    onnew={() => {
      adding = "form";
    }}
  />
{/if}
