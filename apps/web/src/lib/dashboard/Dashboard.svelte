<!--
  The dashboard (ADR 21): master's two-column layout. Landscape never scrolls: the hero takes the
  left ~53 %, the right column answers "now" and "today". On a phone the same blocks stack, hero
  first.
-->
<script lang="ts">
  import type { Core, Live } from "../api/core.ts";
  import DetailSheet from "../detail/DetailSheet.svelte";
  import type { SceneLayout } from "../live/dashboard.ts";
  import { record, type LiveSeries } from "../live-graph/series.ts";
  import type { Go } from "../range/route.svelte.ts";
  import { PLANT, SPOT, TARIFF, readDay, type Day } from "./day.ts";
  import EvCard from "./EvCard.svelte";
  import Hero from "./Hero.svelte";
  import NowStrip from "./NowStrip.svelte";
  import TodayPanel from "./TodayPanel.svelte";

  let {
    core,
    layout,
    admin,
    detail = null,
    onopen = () => {},
    onclose = () => {},
    params = new URLSearchParams(),
    go = () => {},
  }: {
    core: Core;
    /** The layout in force when it has a scene. */
    layout: SceneLayout | null;
    /** Whether the builder is offered. */
    admin: boolean;
    /** The figure whose detail sheet is open (ADR 21). */
    detail?: string | null;
    /** Opens a figure's detail. */
    onopen?: (id: string) => void;
    /** Closes the detail sheet. */
    onclose?: () => void;
    /** The hash route's query, where the sheet's range lives (ADR 21). */
    params?: URLSearchParams;
    go?: Go;
  } = $props();

  /** How often today is reread: its energy and money move slowly. */
  const REREAD_MS = 60_000;

  let live = $state.raw<Live>();
  let day = $state.raw<Day>();

  /** Device names, which only the admin may list (ADR 9). */
  let names = $state.raw<ReadonlyMap<number, string>>(new Map());

  /** Every live power's last two minutes, kept from the start so a sheet opens with its graph. */
  let recent = $state.raw<LiveSeries>({});

  $effect(() =>
    core.live((next) => {
      live = next;

      if ("devices" in next) recent = record(recent, next, Date.now());
    }),
  );

  $effect(() => {
    let stopped = false;

    // A failed read keeps the last day; the next one tries again.
    const read = async () => {
      const next = await readDay(core, new Date()).catch(() => null);

      if (!stopped && next !== null) day = next;
    };

    void read();
    const timer = setInterval(() => void read(), REREAD_MS);

    return () => {
      stopped = true;
      clearInterval(timer);
    };
  });

  $effect(() => {
    void core
      .devices()
      .then((devices) => {
        if (!("problem" in devices)) names = new Map(devices.map((d) => [d.id, d.name]));

        return null;
      })
      .catch(() => null);
  });

  const values = $derived(live !== undefined && "devices" in live ? live.devices : undefined);
  const stale = $derived(live !== undefined && "stale" in live ? live.stale : undefined);

  /** Each EVCC loadpoint, told by its `ev.charge.power` (ADR 10). */
  const loadpoints = $derived(
    Object.entries(values ?? {})
      .filter(([, series]) => "ev.charge.power" in series)
      .map(([id, series]) => ({ id: Number(id), values: series })),
  );
</script>

<main
  class="mx-auto flex max-w-[1600px] flex-col gap-3 px-3 pt-3 pb-3 lg:grid lg:h-dvh lg:min-h-[640px] lg:grid-cols-[minmax(0,53fr)_minmax(0,47fr)] lg:gap-6 lg:py-6 lg:pr-6 lg:pl-0"
>
  <Hero
    {layout}
    {core}
    {admin}
    {live}
    plant={values?.[PLANT]}
    plantStale={stale?.[PLANT]}
    onselect={onopen}
    class="h-[68dvh] min-h-[480px] min-w-0 overflow-hidden rounded-lg ring-1 ring-border/60 elevation-1 lg:h-auto lg:min-h-0"
  />

  <div class="flex min-h-0 min-w-0 flex-col gap-3">
    <NowStrip spot={values?.[SPOT]} tariff={values?.[TARIFF]} {day} {onopen} />
    <TodayPanel tariff={values?.[TARIFF]} {day} {onopen} />
    {#each loadpoints as loadpoint (loadpoint.id)}
      <EvCard
        name={names.get(loadpoint.id)}
        values={loadpoint.values}
        onopen={() => {
          onopen(`ev-${loadpoint.id}`);
        }}
      />
    {/each}
  </div>
</main>

<DetailSheet
  id={detail}
  {core}
  {live}
  series={recent}
  {day}
  {names}
  {params}
  {go}
  {onopen}
  {onclose}
/>
