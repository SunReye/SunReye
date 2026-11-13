<!-- The facts row closing a detail sheet, divided by hairlines. -->
<script lang="ts">
  import FactValue from "./FactValue.svelte";
  import type { Fact } from "./figures.ts";

  let { stats }: { stats: readonly Fact[] } = $props();
</script>

<dl class="grid grid-cols-3 divide-x divide-border/60 border-t border-border/60">
  {#each stats as s (s.label)}
    <div class="flex min-w-0 flex-col gap-0.5 px-5 py-3 first:sm:pl-6">
      <dt class="truncate text-xs text-muted-foreground">{s.label}</dt>
      <dd class="truncate tabular-nums">
        <FactValue fact={s} big={false} />
      </dd>
    </div>
  {/each}
</dl>
