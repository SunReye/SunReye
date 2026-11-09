<script lang="ts">
  import type { ModuleType } from "../api/core.ts";
  import { m } from "../paraglide/messages.js";

  let {
    value,
    moduleTypes,
    onchange,
  }: {
    value: number;
    moduleTypes: readonly ModuleType[];
    onchange: (moduleType: number) => void;
  } = $props();
</script>

<label>
  {m.builder_module_type()}
  <select
    {value}
    onchange={(event) => {
      onchange(Number(event.currentTarget.value));
    }}
  >
    {#each moduleTypes as type (type.id)}
      <option value={type.id}>{type.name}</option>
    {/each}
  </select>
</label>
