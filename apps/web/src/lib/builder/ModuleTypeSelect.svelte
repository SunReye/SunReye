<!-- A grid's or a string's module type, picked from the plant's types. -->
<script lang="ts">
  import type { ModuleType } from "../api/core.ts";
  import { m } from "../paraglide/messages.js";
  import { choices } from "./fields.ts";
  import ValueRow from "./ValueRow.svelte";

  let {
    value,
    moduleTypes,
    onchange,
  }: {
    value: number;
    moduleTypes: readonly ModuleType[];
    onchange: (moduleType: number) => void;
  } = $props();

  const edit = $derived(
    choices(
      m.builder_module_type(),
      moduleTypes.map(({ name }) => name),
    ),
  );
</script>

<ValueRow
  {edit}
  value={moduleTypes.findIndex(({ id }) => id === value)}
  onchange={(index) => {
    const chosen = moduleTypes[index];

    if (chosen !== undefined) onchange(chosen.id);
  }}
/>
