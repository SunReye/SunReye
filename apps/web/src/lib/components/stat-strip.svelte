<!-- The stat strip for facts (ADR 21): each a label over its value, divided by hairlines. Inline it
  sits flush between rules; closing a sheet or a range panel it is the facts row (ADR 21 "Sheet
  content"), one line, a third each or four as wide as each needs, their labels and notes wrapping
  before either is cut. -->
<script lang="ts">
  import FactValue from "../detail/FactValue.svelte";
  import type { Fact } from "../detail/figures.ts";

  let {
    stats,
    closes,
  }: {
    stats: readonly Fact[];
    /** It closes a sheet, or a range panel, whose padding it spans out of as every sheet's facts
     * row spans it. */
    closes?: "sheet" | "panel";
  } = $props();

  const INLINE = {
    strip: "auto-cols-fr grid-flow-col border-y",
    cell: "min-w-0 px-3 py-2.5 first:pl-0 last:pr-0",
  };

  const THIRDS = { strip: "grid-cols-3", cell: "min-w-0 px-5 first:sm:pl-6" };

  // Four take the room each needs, so none shrinks below its value.
  const FOUR = {
    strip: "grid-cols-[repeat(4,auto)]",
    cell: "justify-between px-2 first:pl-5 first:sm:pl-6",
  };

  const look = $derived.by(() => {
    if (closes === undefined) return INLINE;

    const at = stats.length > 3 ? FOUR : THIRDS;

    return {
      strip: ["border-t", at.strip, closes === "panel" && "-mx-5 -mb-4 mt-2 sm:-mx-6"],
      cell: ["py-3", at.cell],
    };
  });
</script>

<dl class={["grid divide-x divide-border/60 border-border/60", look.strip]}>
  {#each stats as s (s.label)}
    <div class={["flex flex-col gap-0.5", look.cell]}>
      <dt class="text-xs text-pretty hyphens-auto break-words text-muted-foreground">
        {s.label}
      </dt>
      <dd class="truncate tabular-nums">
        <FactValue fact={s} big={false} />{#if "note" in s && s.note}{" "}<span
            class="block text-xs text-pretty whitespace-normal text-muted-foreground">{s.note}</span
          >{/if}
      </dd>
    </div>
  {/each}
</dl>
