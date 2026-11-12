<!--
  PROTOTYPE: a figure's detail (ADR 21). It leads with the figure it was opened from; a power figure
  then shows v3's live graph, and the range, tabs and chart follow. A node's sheet (a string, the
  inverter, the battery, the grid, the house, the car) ends with what the device reads now. No
  cards inside the sheet: the sheet is the one surface, divided by hairlines.
-->
<script lang="ts">
  import ArrowRight from "@lucide/svelte/icons/arrow-right";
  import { DETAILS } from "./details";
  import { SPOT, type LiveSim } from "./sim.svelte";
  import DayChart from "./DayChart.svelte";
  import RangeControl from "./RangeControl.svelte";
  import LiveArea from "./live/LiveArea.svelte";
  import AnimatedNumber from "./AnimatedNumber.svelte";
  import Readings from "./Readings.svelte";
  import { ago, nodeReadings } from "./readings";
  import * as Tabs from "#lib/components/ui/tabs/index.js";
  import { haptics } from "./haptics";
  import { input } from "./input.svelte";

  import { buildHistory } from "./stats/history";
  import { customSel, canStep, selFor, selLabel, step, type Sel } from "./stats/query";

  let { id, sim, onhistory, onopen }: { id: string; sim: LiveSim; onhistory: (sel: Sel, id: string) => void; onopen: (id: string) => void } = $props();
  const spec = $derived(DETAILS[id] ?? DETAILS.production!);
  // The sheet's range is its own; "Im Verlauf öffnen" carries it over.
  const history = buildHistory();
  let range = $state<Sel>(selFor(history, "day", history.today));
  let tab = $state("Übersicht");
  const spotMax = Math.max(...SPOT);
  const heat = Array.from({ length: 7 * 24 }, (_, i) => {
    const h = i % 24;
    return Math.max(0, Math.sin(((h - 5.5) / 15.5) * Math.PI)) ** 1.6 * (0.6 + 0.4 * Math.abs(Math.sin(i * 1.7)));
  });

  const loading = $derived(sim.status === "loading");
  const points = $derived(spec.live ? (sim.series[spec.live] ?? []) : []);
  const node = $derived(nodeReadings(id, sim));
  // A silent device has left the two-minute window: its figure is the last one it read.
  const now = $derived(points.at(-1)?.v ?? node?.last ?? 0);
  // Signed figures say their direction in words; the sign itself never reaches the reader.
  const direction = $derived.by(() => {
    if (!spec.diverging || Math.abs(now) < 50) return "";
    if (spec.live === "battery") return now > 0 ? "lädt" : "entlädt";
    return now > 0 ? "Bezug" : "Einspeisung";
  });
  const nowColour = $derived(spec.diverging ? (now >= 0 ? spec.diverging[0] : spec.diverging[1]) : spec.colour);
  const strings = $derived(spec.live === "pv" && sim.strings.length > 1 ? sim.strings : []);
  const estimated = (sid: string) => sim.readings[`pv.string.power[${sid}]`]?.est === true;

  // A string is known by the name its owner gave it.
  const title = $derived(sim.strings.find((s) => s.id === id)?.name ?? spec.title);
  /** Seconds since the device or the stream last delivered, when it no longer does. */
  const silent = $derived(node?.silent ?? (sim.status === "stalled" || sim.status === "error" ? sim.age : null));
</script>

<div class="flex min-h-full flex-col">
  <header class="flex flex-col gap-3 px-5 pt-5 pb-4 sm:px-6">
    <h2 class="flex items-baseline gap-2 pr-10 text-base font-semibold"><span class="size-2 shrink-0 -translate-y-px rounded-[1px]" style:background={nowColour}></span><span class="line-clamp-2 min-w-0 break-words">{title}</span></h2>
    <div class="flex items-end justify-between gap-4">
      {#if spec.today}
        <p class="flex flex-col">
          <span class="text-4xl leading-none font-semibold tracking-tight"><AnimatedNumber value={loading ? null : sim.today[spec.today]} /> <span class="text-lg font-medium text-muted-foreground">kWh</span></span>
          <span class="mt-1 text-xs text-muted-foreground">heute</span>
        </p>
      {/if}
      {#if spec.live}
        <p class={["flex flex-col", spec.today && "items-end text-right"]}>
          <span class={[spec.today ? "text-xl" : "text-4xl", "leading-none font-semibold tracking-tight", silent !== null && "opacity-60"]}>
            {#if node?.leadEstimated}<span class="me-1 font-normal text-muted-foreground" title="geschätzt" aria-label="geschätzt">≈</span>{/if}<AnimatedNumber value={loading ? null : Math.abs(now) / 1000} /> <span class={[spec.today ? "text-sm" : "text-lg", "font-medium text-muted-foreground"]}>kW</span>
          </span>
          <!-- The label stops claiming "now" the moment the readings do. -->
          {#if silent !== null}
            <span class="mt-1 text-xs text-warning">zuletzt {ago(silent)}</span>
          {:else}
            <span class="mt-1 text-xs text-muted-foreground">jetzt{direction ? ` · ${direction}` : ""}{node?.leadEstimated ? " · geschätzt" : ""}</span>
          {/if}
        </p>
      {:else if !spec.today}
        <p class="flex flex-col">
          <span class="text-4xl leading-none font-semibold tracking-tight">{spec.stats[0]![1]}</span>
          <span class="mt-1 text-xs text-muted-foreground">{spec.stats[0]![0]}</span>
        </p>
      {/if}
    </div>
  </header>

  {#if spec.live}
    <section class="flex flex-col gap-1 border-t border-border/60 px-5 pt-3 pb-4 sm:px-6" aria-label="Live">
      <div class="flex items-baseline justify-between text-xs text-muted-foreground">
        <span class="font-medium">
          {#if silent !== null}<span class="text-warning">{node?.silent != null ? "Gerät antwortet nicht" : "Angehalten"} · keine Daten seit {ago(silent).slice(4)}</span>{:else}Live · letzte 2 Minuten{/if}
        </span>
        <span>kW</span>
      </div>
      {#if points.length === 0 && !loading}
        <!-- The plot's place is held: nothing below it moves when the device answers again. -->
        <p class="flex items-center justify-center text-xs text-muted-foreground" style:height="{input.wide ? 150 : 128}px">Keine Werte in den letzten 2 Minuten</p>
      {:else}
        <LiveArea
          {points}
          accent={spec.diverging ? spec.diverging[0] : spec.colour}
          below={spec.diverging ? spec.diverging[1] : spec.colour}
          diverging={Boolean(spec.diverging)}
          height={input.wide ? 150 : 128}
          label={title}
          stalled={sim.status !== "live" || silent !== null}
        />
      {/if}
      {#if strings.length > 0}
        <!-- Per-string split of the same reading; each opens its own sheet. -->
        <div class="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
          {#each strings as s (s.id)}
            <button type="button" class="flex items-baseline gap-1.5 rounded-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring" onclick={() => onopen(s.id)}>
              <span class="max-w-40 truncate">{s.name}</span>
              <span class="font-semibold whitespace-nowrap text-foreground tabular-nums">{#if estimated(s.id)}<span class="me-1 font-normal text-muted-foreground">≈</span>{/if}<AnimatedNumber value={s.kw} /></span> kW
            </button>
          {/each}
        </div>
      {/if}
    </section>
  {/if}

  <section class="flex flex-col gap-3 border-t border-border/60 px-5 pt-4 pb-4 sm:px-6" aria-label="Verlauf">
    <RangeControl
      kind={range.kind}
      label={selLabel(history, range)}
      canPrev={canStep(history, range, -1)}
      canNext={canStep(history, range, 1)}
      onkind={(k) => (range = k === "custom" ? customSel(history, history.today - 9, history.today + 1) : selFor(history, k, history.today))}
      onstep={(dir) => (range = step(history, range, dir))}
    />

    <Tabs.Root bind:value={() => tab, (v: string) => {
      if (v !== tab) haptics.selection();
      tab = v;
    }}>
      <Tabs.List variant="line">
        {#each ["Übersicht", "Heatmap", "Vergleich"] as t (t)}
          <Tabs.Trigger value={t}>{t}</Tabs.Trigger>
        {/each}
      </Tabs.List>
      <Tabs.Content value="Übersicht" class="pt-2">
        {#if spec.metric === "price"}
          <div class="flex h-[190px] items-end gap-[3px]">
            {#each SPOT as p, h (h)}
              <span class={["flex-1 rounded-sm", h === 15 ? "bg-foreground" : "bg-foreground/25"]} style:height="{(p / spotMax) * 100}%"></span>
            {/each}
          </div>
        {:else}
          <DayChart data={sim.day} height={190} metric={spec.metric} />
        {/if}
      </Tabs.Content>
      <Tabs.Content value="Heatmap" class="pt-2">
        <div class="grid gap-[2px]" style:grid-template-columns="repeat(24, minmax(0, 1fr))">
          {#each heat as v, i (i)}
            <span class="aspect-square rounded-[1px]" style:background="color-mix(in oklab, {spec.colour} {Math.round(v * 100)}%, transparent)"></span>
          {/each}
        </div>
      </Tabs.Content>
      <Tabs.Content value="Vergleich" class="pt-2">
        <p class="py-8 text-center text-sm text-muted-foreground">String-Vergleich (Platzhalter)</p>
      </Tabs.Content>
    </Tabs.Root>
  </section>

  <dl class="grid grid-cols-3 divide-x divide-border/60 border-t border-border/60 [&:has(+section)]:border-b">
    {#each spec.stats as [k, v] (k)}
      <div class="flex min-w-0 flex-col gap-0.5 px-5 py-3 first:sm:pl-6">
        <dt class="truncate text-xs text-muted-foreground">{k}</dt>
        <dd class="truncate text-sm font-semibold tabular-nums">{v}</dd>
      </div>
    {/each}
  </dl>

  <Readings {id} {sim} {onopen} />

  <!-- The sheet's one way onward, at the end where the scan ends. -->
  <button
    type="button"
    class="group mt-auto flex items-center justify-between gap-3 border-t border-border/60 px-5 py-4 text-left text-sm font-medium text-brand outline-none transition-colors hover:bg-foreground/[0.04] focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset sm:px-6"
    onclick={() => onhistory(range, id)}
  >
    Im Verlauf öffnen · {selLabel(history, range)}
    <ArrowRight class="size-4 transition-transform group-hover:translate-x-0.5" />
  </button>
</div>
