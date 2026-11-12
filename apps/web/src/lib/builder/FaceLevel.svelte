<!-- A roof face's level (ADR 20): its module-grid editor, or the button that lays a grid on it. -->
<script lang="ts">
  import Plus from "@lucide/svelte/icons/plus";
  import { Button } from "#lib/components/ui/button/index.js";
  import type { ModuleType } from "../api/core.ts";
  import { m } from "../paraglide/messages.js";
  import FaceGrid from "./FaceGrid.svelte";
  import { addGrid, type Draft } from "./modules.ts";
  import type { Plan } from "./outline.ts";
  import type { RoofFace } from "./pv.ts";

  let {
    roof,
    plan,
    moduleTypes,
    moduleType,
    onchange,
  }: {
    roof: RoofFace;
    plan: Plan;
    moduleTypes: readonly ModuleType[];
    /** A new grid's module type; without one no grid is laid. */
    moduleType: number | undefined;
    onchange: (draft: Draft) => void;
  } = $props();

  const draft = $derived(plan.draft);

  const index = $derived(
    (draft.scene.grids ?? []).findIndex((g) => g.block === roof.block && g.face === roof.face),
  );
</script>

{#if draft.scene.grids?.[index] !== undefined}
  <FaceGrid
    {draft}
    {index}
    grid={draft.scene.grids[index]}
    {roof}
    cells={plan.laid.grids[index] ?? []}
    {moduleTypes}
    {onchange}
  />
{:else if moduleType !== undefined}
  <div class="p-3">
    <Button
      variant="outline"
      class="w-full justify-start"
      onclick={() => {
        onchange({ ...draft, scene: addGrid(draft.scene, roof.block, roof.face, moduleType) });
      }}
    >
      <Plus data-icon="inline-start" />
      {m.builder_add_grid()}
    </Button>
  </div>
{:else}
  <p class="px-4 py-3 text-sm text-muted-foreground">{m.builder_no_module_types()}</p>
{/if}
