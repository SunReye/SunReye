<!-- One cell of a readings table: the number, dimmed with its age as a title once stale. -->
<script lang="ts">
  import AnimatedNumber from "../components/animated-number.svelte";
  import { ago } from "./readings.ts";
  import type { Row } from "./rows.ts";

  let { cell, loading, silent }: { cell: Row | null; loading: boolean; silent: boolean } = $props();

  const age = $derived(silent ? undefined : cell?.age);
  const value = $derived(loading ? null : (cell?.value ?? null));
</script>

<td
  class={[
    "py-2 pl-3 text-right font-semibold",
    (silent || cell?.age !== undefined) && "opacity-60",
  ]}
  title={age === undefined ? undefined : ago(age)}
>
  {#if cell}<AnimatedNumber {value} digits={cell.digits} />{:else}<span
      class="font-normal text-muted-foreground">–</span
    >{/if}
</td>
