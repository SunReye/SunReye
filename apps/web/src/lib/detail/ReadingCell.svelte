<!-- One cell of a readings table: the number, dimmed with its age as a title once stale. -->
<script lang="ts">
  import * as Table from "../components/ui/table/index.js";
  import { isPower } from "../power.ts";
  import Quantity from "./Quantity.svelte";
  import { ago } from "./readings.ts";
  import type { Row } from "./rows.ts";

  let { cell, loading, silent }: { cell: Row | null; loading: boolean; silent: boolean } = $props();

  const age = $derived(silent ? undefined : cell?.age);
  const value = $derived(loading ? null : (cell?.value ?? null));
</script>

<Table.Cell
  class={[
    "py-2 pr-0 pl-3 text-right font-semibold",
    (silent || cell?.age !== undefined) && "opacity-60",
  ]}
  title={age === undefined ? undefined : ago(age)}
>
  <!-- The head carries every unit but a power's. -->
  {#if cell}<Quantity
      {value}
      unit={isPower(cell.unit) ? cell.unit : ""}
      digits={cell.digits}
      unitClass="font-normal text-muted-foreground"
    />{:else}<span
      class="font-normal text-muted-foreground">–</span
    >{/if}
</Table.Cell>
