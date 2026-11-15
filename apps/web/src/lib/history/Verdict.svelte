<!-- The sentence that answers the question; it changes with the question and the range. -->
<script lang="ts">
  import { Skeleton } from "#lib/components/ui/skeleton/index.js";
  import { m } from "../paraglide/messages.js";
  import { num } from "../range/format.ts";
  import Pager from "../range/Pager.svelte";

  let {
    id,
    sentence,
    gapHours,
  }: {
    /** What makes it a new sentence: the range, the question, the baseline. */
    id: string;
    /** Null while the range loads. */
    sentence: string | null;
    gapHours: number;
  } = $props();
</script>

<div class="min-h-[3rem] @[640px]:min-h-[2rem]">
  {#if sentence === null}
    <Skeleton class="mt-1 h-5 w-4/5" />
  {:else}
    <Pager
      {id}
      data={{ sentence, gapHours }}
      travel={() => ({ kind: "shift", dir: 0 })}
      after={110}
    >
      {#snippet children(d)}
        <p class="max-w-[62ch] text-base leading-6 font-medium text-pretty @[640px]:text-lg">
          {d.sentence}{#if d.gapHours > 0}<span class="text-sm font-normal text-muted-foreground"
              >{" "}{m.stats_gap_hours({ hours: num(d.gapHours) })}</span
            >{/if}
        </p>
      {/snippet}
    </Pager>
  {/if}
</div>
