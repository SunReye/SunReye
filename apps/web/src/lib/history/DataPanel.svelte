<!-- How complete the record is: coverage of the range and every gap, each opening its day. -->
<script lang="ts">
  import StatStrip from "../components/stat-strip.svelte";
  import { Pressable } from "@sunreye/ui/pressable";
  import ChevronRight from "@lucide/svelte/icons/chevron-right";
  import CircleCheck from "@lucide/svelte/icons/circle-check";
  import { m } from "../paraglide/messages.js";
  import { plantNow } from "../plant-day.ts";
  import { fmt, shortDay } from "../range/calendar.ts";
  import type { Span } from "../range/fill.ts";
  import { num } from "../range/format.ts";
  import { rangeFor, type Range } from "../range/range.ts";

  let {
    gaps,
    covered,
    elapsed,
    label,
    since,
    zone,
    onopen,
  }: {
    gaps: readonly Span[];
    /** In ms. */
    covered: number;
    elapsed: number;
    label: string;
    since: number | null;
    zone: string;
    onopen: (r: Range) => void;
  } = $props();

  const HOUR = 3_600_000;
  const coverage = $derived(elapsed > 0 ? covered / elapsed : null);

  const rows = $derived(
    gaps.map((g) => {
      const { day, hour } = plantNow(zone, new Date(g.start));

      return {
        key: g.start,
        from: `${fmt("dayShort", day)}, ${hour}:00`,
        hours: Math.round((g.end - g.start) / HOUR),
        range: rangeFor("day", day),
      };
    }),
  );
</script>

<div class="flex min-h-[300px] flex-col gap-4">
  <StatStrip
    stats={[
      {
        label: m.stats_coverage({ range: label }),
        text:
          coverage === null
            ? "–"
            : `${num(coverage * 100, coverage < 1 && coverage > 0.99 ? 1 : 0)} %`,
      },
      { label: m.stats_gap_total(), text: num(Math.max(0, elapsed - covered) / HOUR) },
      { label: m.stats_recording_since(), text: since === null ? "–" : shortDay(since, true) },
    ]}
  />

  <section aria-label={m.stats_gaps()}>
    <h3 class="pb-1 text-xs font-medium text-muted-foreground">{m.stats_gaps()}</h3>
    {#if rows.length > 0}
      <ul class="divide-y divide-border/60 border-y border-border/60">
        {#each rows as g (g.key)}
          <li>
            <Pressable
              feedback
              class="flex w-full items-baseline gap-3 py-2 text-left text-sm"
              onclick={() => {
                onopen(g.range);
              }}
            >
              <span class="min-w-0 flex-1 tabular-nums"
                >{m.stats_gap_row({ from: g.from })}<span
                  class="block text-xs text-muted-foreground">{m.stats_gap_cause()}</span
                ></span
              >
              <span class="font-semibold tabular-nums">{g.hours} h</span>
              <ChevronRight class="size-4 shrink-0 self-center text-muted-foreground" />
            </Pressable>
          </li>
        {/each}
      </ul>
    {:else}
      <p class="flex items-center gap-2 border-y border-border/60 py-3 text-sm">
        <CircleCheck class="size-4 text-success" />{m.stats_no_gaps()}
      </p>
    {/if}
  </section>
  <p class="max-w-[68ch] text-xs text-muted-foreground">{m.stats_data_note()}</p>
</div>
