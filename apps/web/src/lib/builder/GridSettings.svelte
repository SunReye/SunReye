<!-- A face grid's module type, orientation and edge setback. -->
<script lang="ts">
  import * as Item from "#lib/components/ui/item/index.js";
  import type { ModuleType } from "../api/core.ts";
  import { m } from "../paraglide/messages.js";
  import { choices, metres } from "./fields.ts";
  import ModuleTypeSelect from "./ModuleTypeSelect.svelte";
  import type { ModuleGrid } from "./pv.ts";
  import ValueRow from "./ValueRow.svelte";

  let {
    grid,
    moduleTypes,
    onedit,
  }: {
    grid: ModuleGrid;
    moduleTypes: readonly ModuleType[];
    onedit: (fields: Partial<Pick<ModuleGrid, "moduleType" | "landscape" | "setback">>) => void;
  } = $props();

  const orientation = choices(m.builder_orientation(), [
    m.builder_portrait(),
    m.builder_landscape(),
  ]);

  const setback = metres(m.field_setback(), 0, 3, 0.05);
</script>

<Item.Group class="gap-0 divide-y divide-border/60">
  <ModuleTypeSelect
    value={grid.moduleType}
    {moduleTypes}
    onchange={(moduleType) => {
      onedit({ moduleType });
    }}
  />
  <ValueRow
    edit={orientation}
    value={grid.landscape ? 1 : 0}
    onchange={(index) => {
      onedit({ landscape: index === 1 });
    }}
  />
  <ValueRow
    edit={setback}
    value={grid.setback}
    onchange={(value) => {
      onedit({ setback: value });
    }}
  />
</Item.Group>
