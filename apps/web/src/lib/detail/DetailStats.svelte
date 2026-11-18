<!-- The facts row closing a detail sheet, divided by hairlines: one line (ADR 21 "Sheet
  content"), a third each, or four as wide as each needs, their labels and notes wrapping before
  either is cut. -->
<script lang="ts">
  import FactValue from "./FactValue.svelte";
  import type { Fact } from "./figures.ts";

  let {
    stats,
    panel = false,
  }: {
    stats: readonly Fact[];
    /** It closes a range panel: it spans the sheet out of the panel's padding, as every sheet's
     * facts row spans it. */
    panel?: boolean;
  } = $props();

  const four = $derived(stats.length > 3);
</script>

<dl
  class={[
    "grid divide-x divide-border/60 border-t border-border/60",
    panel && "-mx-5 -mb-4 mt-2 sm:-mx-6",
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
      <dt class="text-xs text-pretty hyphens-auto break-words text-muted-foreground">
        {s.label}
      </dt>
      <dd class="truncate tabular-nums">
        <FactValue fact={s} big={false} />
        {#if "note" in s && s.note}
          <span class="block text-xs text-pretty whitespace-normal text-muted-foreground"
            >{s.note}</span
          >
        {/if}
      </dd>
    </div>
  {/each}
</dl>
