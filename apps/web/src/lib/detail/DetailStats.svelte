<!-- The facts row closing a detail sheet, divided by hairlines: one line (ADR 21 "Sheet
  content"), a third each, or four as wide as each needs, their labels wrapping before a value
  is cut. -->
<script lang="ts">
  import FactValue from "./FactValue.svelte";
  import type { Fact } from "./figures.ts";

  let { stats }: { stats: readonly Fact[] } = $props();

  const four = $derived(stats.length > 3);
</script>

<dl
  class={[
    "grid divide-x divide-border/60 border-t border-border/60",
    four ? "grid-cols-[repeat(4,auto)]" : "grid-cols-3",
  ]}
>
  {#each stats as s (s.label)}
    <div
      class={[
        "flex flex-col gap-0.5 py-3",
        // Four take the room each needs, so none shrinks below its value.
        four ? "justify-between px-2 first:pl-5 first:sm:pl-6" : "min-w-0 px-5 first:sm:pl-6",
      ]}
    >
      <dt class={["text-xs text-muted-foreground", four ? "text-pretty" : "truncate"]}>
        {s.label}
      </dt>
      <dd class="truncate tabular-nums">
        <FactValue fact={s} big={false} />
      </dd>
    </div>
  {/each}
</dl>
