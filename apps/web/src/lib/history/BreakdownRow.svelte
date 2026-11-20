<!-- One line of the breakdown: its colour, label, note and value, with its change under the value. -->
<script lang="ts">
  import FigureNumber from "./FigureNumber.svelte";
  import type { Row } from "./breakdown.ts";

  let { r, loading }: { r: Row; loading: boolean } = $props();

  const sub = $derived(loading ? " " : r.sub);
</script>

<div class={["flex items-baseline gap-2 px-4 py-2", r.indent && "pl-8"]}>
  {#if r.colour}<span class="size-2 shrink-0 rounded-[1px]" style:background={r.colour}></span>{/if}
  <dt class="min-w-0 flex-1 text-sm">
    {r.label}
    {#if r.sub}
      <span class="block text-xs text-muted-foreground tabular-nums">{sub}</span>
    {/if}
  </dt>
  <dd class="text-right text-sm font-semibold whitespace-nowrap tabular-nums">
    <FigureNumber
      value={loading ? null : r.value}
      format={r.format}
      placeholder="–"
      appear={false}
    />
    {#if r.change && !loading}
      <span class="block text-xs font-normal text-muted-foreground">{r.change}</span>
    {/if}
  </dd>
</div>
