<!-- Every recorded year for the question against the same dates before, and the records since the start; each opens its range. -->
<script lang="ts">
  import { Pressable } from "@sunreye/ui/pressable";
  import ChevronRight from "@lucide/svelte/icons/chevron-right";
  import type { Records } from "../api/records.ts";
  import { m } from "../paraglide/messages.js";
  import type { RangeRoute } from "../range/route.svelte.ts";
  import { recordRows, yearRows, type YearsCore } from "./records.ts";
  import type { Metric } from "./view.ts";

  let { core, route, metric }: { core: YearsCore; route: RangeRoute; metric: Metric } = $props();

  let records = $state.raw<Records | null>(null);

  $effect(() => {
    let live = true;

    void core.records().then((read) => {
      if (live && !("problem" in read)) records = read;

      return read;
    });

    return () => {
      live = false;
    };
  });

  const years = $derived(records ? yearRows(metric, records) : []);

  const best = $derived(records ? recordRows(records) : []);
</script>

<div class="grid gap-x-6 gap-y-4 @[640px]:grid-cols-2">
  <section aria-label={m.stats_years_list()}>
    <h3 class="pb-1 text-xs font-medium text-muted-foreground">{m.stats_years_list()}</h3>
    <ul class="divide-y divide-border/60 border-y border-border/60">
      {#each years as y (y.year)}
        <li>
          <Pressable
            feedback
            class="flex w-full items-baseline gap-3 py-2 text-left text-sm"
            onclick={() => {
              route.open(y.range);
            }}
          >
            <span class="w-24 font-medium tabular-nums">
              {y.year}{#if y.running}<span class="font-normal text-muted-foreground">
                  {" "}{m.stats_years_running()}
                </span>{/if}
            </span>
            <span class="flex-1 text-right font-semibold tabular-nums">{y.value}</span>
            <span class="w-20 text-right text-xs text-muted-foreground tabular-nums">
              {y.change}
            </span>
            <ChevronRight class="size-4 shrink-0 self-center text-muted-foreground" />
          </Pressable>
        </li>
      {/each}
    </ul>
  </section>
  <section aria-label={m.stats_records()}>
    <h3 class="pb-1 text-xs font-medium text-muted-foreground">{m.stats_records_title()}</h3>
    <ul class="divide-y divide-border/60 border-y border-border/60">
      {#each best as r (r.label)}
        <li>
          <Pressable
            feedback
            class="flex w-full items-baseline gap-3 py-2 text-left text-sm"
            onclick={() => {
              route.open(r.range);
            }}
          >
            <span class="min-w-0 flex-1">
              {r.label}<span class="block text-xs text-muted-foreground">{r.when}</span>
            </span>
            <span class="font-semibold tabular-nums">{r.value}</span>
            <ChevronRight class="size-4 shrink-0 self-center text-muted-foreground" />
          </Pressable>
        </li>
      {/each}
    </ul>
  </section>
</div>
