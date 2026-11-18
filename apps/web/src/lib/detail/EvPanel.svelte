<!--
  The EV and loadpoint sheets' range below their tabs (ADR 21 "Sheet content"): the sessions, newest
  first, each its clock times and what it charged, a skeleton in their place while they read; a
  range no car charged in says so once. Then one
  row of facts: the share PV met directly and the count of sessions.
-->
<script lang="ts">
  import { Skeleton } from "#lib/components/ui/skeleton/index.js";
  import { m } from "../paraglide/messages.js";
  import type { AnalyticsInput } from "./Analytics.svelte";
  import DetailStats from "./DetailStats.svelte";
  import { whenOf } from "./ev.ts";
  import { EV_RANGE } from "./ev-range.ts";
  import { pvCoveredFact } from "./facts.ts";
  import Quantity from "./Quantity.svelte";
  import RangeState from "./RangeState.svelte";
  import { SheetRange } from "./sheet-range.svelte.ts";

  let { input, device }: { input: AnalyticsInput; device: number } = $props();

  /** Past this many, the earlier sessions are counted, not listed. */
  const SHOWN = 10;

  const range = new SheetRange(
    () => ({ core: input.core, route: input.route, key: String(device), device }),
    EV_RANGE,
  );

  const view = $derived(range.view);
  const zone = $derived(input.route.place.zone);

  const facts = $derived([
    pvCoveredFact(view?.share ?? null),
    { label: m.detail_sessions(), value: view?.sessions.length ?? null, unit: "", digits: 0 },
  ]);
</script>

<RangeState failed={range.failed} onretry={range.retry}>
  {#if view && view.sessions.length === 0}
    <p class="py-2 text-sm text-muted-foreground">{m.detail_no_sessions()}</p>
  {:else if view}
    <ul class="flex flex-col divide-y divide-border/60" aria-label={m.detail_sessions()}>
      {#each view.sessions.slice(0, SHOWN) as s (s.start)}
        <li class="flex items-baseline justify-between gap-4 py-2 text-sm">
          <span class="min-w-0 text-pretty">{whenOf(s, view.days, zone)}</span>
          <span class="shrink-0 font-semibold tabular-nums"
            ><Quantity
              value={s.kwh}
              unit="kWh"
              unitClass="font-medium text-muted-foreground"
            /></span
          >
        </li>
      {/each}
    </ul>
    {#if view.sessions.length > SHOWN}
      <p class="text-xs text-muted-foreground">
        {m.detail_sessions_more({ count: view.sessions.length - SHOWN })}
      </p>
    {/if}
  {:else}
    <Skeleton class="h-20" role="status" aria-label={m.loading()} />
  {/if}
  <DetailStats panel stats={facts} />
</RangeState>
