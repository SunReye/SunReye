<!-- Summary figures in one strip divided by hairlines (ADR 21): each a label over its value. -->
<script lang="ts">
  let { stats }: { stats: readonly { readonly label: string; readonly value: string }[] } =
    $props();
</script>

<dl
  class="grid auto-cols-fr grid-flow-col divide-x divide-border/60 border-y border-border/60"
>
  {#each stats as stat (stat.label)}
    <div class="flex min-w-0 flex-col gap-0.5 px-3 py-2.5 first:pl-0 last:pr-0">
      <dt class="text-xs text-pretty text-muted-foreground">{stat.label}</dt>
      <dd class="text-base font-semibold tabular-nums">{stat.value}</dd>
    </div>
  {/each}
</dl>
