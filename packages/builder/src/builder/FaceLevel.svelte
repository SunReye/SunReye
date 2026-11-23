<!--
  A roof face's level (ADR 20): its module-grid editor or, before one, its module type. A type picked,
  copied from the module catalogue or entered here lays the grid at once.
-->
<script lang="ts">
  import type { Keeper, ModuleType } from "./host.ts";
  import FaceGrid from "./FaceGrid.svelte";
  import { gridOn, moduleOf, type Level } from "./levels.ts";
  import ModuleLevel from "./ModuleLevel.svelte";
  import ModuleCatalogue from "./ModuleCatalogue.svelte";
  import { addGrid, type Draft } from "./modules.ts";
  import ModuleTypeForm from "./ModuleTypeForm.svelte";
  import ModuleTypePicker from "./ModuleTypePicker.svelte";
  import type { Plan } from "./outline.ts";
  import type { RoofFace } from "./pv.ts";

  let {
    roof,
    module,
    plan,
    moduleTypes,
    types,
    onchange,
    onremove,
  }: {
    roof: RoofFace;
    /** A module of the face, tapped in 3D: its own level. */
    module?: Extract<Level, { kind: "module" }> | undefined;
    plan: Plan;
    moduleTypes: readonly ModuleType[];
    /** Adds module types to the core, and its catalogue to add them from. */
    types: Pick<Keeper, "addModuleType">;
    onchange: (draft: Draft) => void;
    /** Takes the tapped module off the face. */
    onremove: () => void;
  } = $props();

  const draft = $derived(plan.draft);

  const index = $derived(gridOn(draft.scene, roof));

  /** What shows instead of the types: the module catalogue or the new module type's form. */
  let adding = $state<"catalogue" | "form">();

  const tapped = $derived(module && moduleOf(draft.scene, module));

  function lay(moduleType: number): void {
    onchange({ ...draft, scene: addGrid(draft.scene, roof.block, roof.face, moduleType) });
  }
</script>

{#if tapped !== undefined}
  <ModuleLevel
    {draft}
    grid={tapped.grid}
    module={tapped.module}
    laid={tapped.laid}
    {onchange}
    {onremove}
  />
{:else if draft.scene.grids?.[index] !== undefined}
  <FaceGrid
    {draft}
    {index}
    grid={draft.scene.grids[index]}
    free={plan.pv.fillFace({ scene: draft.scene, sizes: plan.sizes, grid: index })}
    checks={{
      misplaced: plan.laid.misplaced?.grid === index ? plan.laid.misplaced : null,
      cold: plan.cold,
    }}
    {moduleTypes}
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
