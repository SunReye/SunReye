<script lang="ts">
  import type { Core } from "../api/core.ts";
  import { m } from "../paraglide/messages.js";
  import { getLocale } from "../paraglide/runtime.js";
  import PowerLines from "../PowerLines.svelte";
  import { historyRows, type Span } from "./history.ts";

  let { core, device, series }: { core: Core; device: number; series: string } = $props();

  let span = $state<Span>("day");

  const spans: readonly (readonly [Span, string])[] = [
    ["day", m.history_day()],
    ["week", m.history_week()],
    ["month", m.history_month()],
    ["year", m.history_year()],
  ];

  /** The SPA's locale, not the browser's; a day shows clock times, longer spans dates. */
  const time = $derived(
    new Intl.DateTimeFormat(
      getLocale(),
      span === "day" ? { hour: "2-digit", minute: "2-digit" } : { day: "numeric", month: "short" },
    ),
  );

  const loaded = $derived(historyRows(core, device, series, span));
</script>

<section>
  <label>
    {m.history_span()}
    <select bind:value={span}>
      {#each spans as [key, text] (key)}
        <option value={key}>{text}</option>
      {/each}
    </select>
  </label>
  <!-- PowerLines draws on canvas, so 1,500 points stay cheap (ADR 11). -->
  <figure>
    {#await loaded then data}
      <PowerLines rows={data} height={280} {time} />
    {/await}
  </figure>
</section>
