<!-- What a day of the PV forecast sheet heads with (ADR 21 "Details by drilling down"): today the
  energy still to come beside the day's total, a later day its expected total beside its peak
  and its change against today. -->
<script lang="ts">
  import Quantity from "../detail/Quantity.svelte";
  import { delta } from "../history/words.ts";
  import { m } from "../paraglide/messages.js";
  import { getLocale } from "../paraglide/runtime.js";
  import { formatPower } from "../power.ts";
  import { kwh } from "../range/format.ts";
  import type { AheadDay } from "./ahead.ts";

  let { day, zone }: { day: AheadDay; zone: string } = $props();

  /** Today is the day with something still to come. */
  const today = $derived(day.remaining !== null);

  const clock = $derived(
    new Intl.DateTimeFormat(getLocale(), { hour: "2-digit", minute: "2-digit", timeZone: zone }),
  );

  /** Beside the energy: today the day's total, later its peak and its change against today. */
  const beside = $derived(
    today
      ? [{ label: m.detail_total(), value: kwh(day.total) }]
      : [
          ...(day.peak === null
            ? []
            : [
                {
                  label: m.ahead_peak_at({ time: clock.format(day.peak.at) }),
                  value: formatPower(day.peak.watts),
                },
              ]),
          ...(day.change === null ? [] : [{ label: m.ahead_vs_today(), value: delta(day.change) }]),
        ],
  );
</script>

<div class="flex items-end justify-between gap-4">
  <p class="flex flex-col" data-energy>
    <span class="text-4xl leading-none font-semibold tracking-tight"
      ><Quantity
        value={day.remaining ?? day.total}
        unit="kWh"
        unitClass="text-lg font-medium text-muted-foreground"
      /></span
    >
    <span class="mt-1 text-xs text-muted-foreground"
      >{today ? m.ahead_left() : m.ahead_expected()}</span
    >
  </p>
  <dl class="flex gap-5 text-right" data-headline>
    {#each beside as fact (fact.label)}
      <div class="flex flex-col-reverse">
        <dt class="mt-1 text-xs whitespace-nowrap text-muted-foreground">{fact.label}</dt>
        <dd class="text-sm font-semibold whitespace-nowrap tabular-nums">{fact.value}</dd>
      </div>
    {/each}
  </dl>
</div>
