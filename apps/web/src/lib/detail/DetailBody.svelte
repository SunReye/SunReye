<!--
  A figure's detail (ADR 21). It leads with the figure it was opened from; a node's readings follow
  where the live graph ends, then the day's chart and facts. No cards inside the sheet: the sheet
  is the one surface, divided by hairlines. It ends with the one way onward.
-->
<script lang="ts">
  import ArrowRight from "@lucide/svelte/icons/arrow-right";
  import AnimatedNumber from "../components/animated-number.svelte";
  import type { Day } from "../dashboard/day.ts";
  import { m } from "../paraglide/messages.js";
  import DayFigure from "./DayFigure.svelte";
  import { facts, type Fact, type Figure } from "./figures.ts";
  import LiveSection from "./LiveSection.svelte";
  import Readings from "./Readings.svelte";
  import { ago, type NodeReadings } from "./readings.ts";

  let {
    id,
    title,
    spec,
    node,
    status,
    day,
    spot,
    onopen,
  }: {
    id: string;
    title: string;
    spec: Figure;
    node: NodeReadings | null;
    status: "loading" | "live" | "stopped";
    day: Day | undefined;
    /** The spot-price device's live values. */
    spot: Readonly<Record<string, number>> | undefined;
    onopen: (id: string) => void;
  } = $props();

  const loading = $derived(status === "loading");
  const shown = $derived(facts(id, day, spot?.["price.spot"]));
  const power = $derived(spec.node !== null);
  const watts = $derived(node?.lead ?? null);
  const silent = $derived(node?.silent ?? null);

  // Signed figures say their direction in words; the sign itself never reaches the reader.
  const direction = $derived.by(() => {
    if (spec.direction === undefined || watts === null || Math.abs(watts) < 50) return "";

    if (spec.direction === "battery")
      return watts > 0 ? m.detail_charging() : m.detail_discharging();

    return watts > 0 ? m.detail_importing() : m.detail_exporting();
  });

  const colour = $derived(
    spec.direction === "grid"
      ? (watts ?? 0) >= 0
        ? "var(--e-import)"
        : "var(--e-export)"
      : spec.colour,
  );

  const nowLine = $derived(
    [m.detail_now(), direction, node?.leadEstimated ? m.detail_estimated() : ""]
      .filter(Boolean)
      .join(" · "),
  );
</script>

{#snippet fact(f: Fact, big: boolean)}
  {#if "text" in f}
    <span class="text-sm font-semibold">{f.text}</span>
  {:else}
    <span
      class={big ? "text-4xl leading-none font-semibold tracking-tight" : "text-sm font-semibold"}
      ><AnimatedNumber value={f.value} digits={f.digits} />
      <span class={[big ? "text-lg" : "", "font-medium text-muted-foreground"]}>{f.unit}</span
      ></span
    >
  {/if}
{/snippet}

<div class="flex min-h-full flex-col">
  <header class="flex flex-col gap-3 px-5 pt-5 pb-4 sm:px-6">
    <h2 class="flex items-baseline gap-2 pr-10 text-base font-semibold">
      <span class="size-2 shrink-0 -translate-y-px rounded-[1px]" style:background={colour}></span>
      <span class="line-clamp-2 min-w-0 break-words">{title}</span>
    </h2>
    <div class="flex items-end justify-between gap-4">
      {#if spec.today}
        <p class="flex flex-col">
          <span class="text-4xl leading-none font-semibold tracking-tight"
            ><AnimatedNumber value={day?.today[spec.today] ?? null} />
            <span class="text-lg font-medium text-muted-foreground">kWh</span></span
          >
          <span class="mt-1 text-xs text-muted-foreground">{m.detail_today()}</span>
        </p>
      {/if}
      {#if power}
        <p class={["flex flex-col", spec.today && "items-end text-right"]}>
          <span
            class={[
              spec.today ? "text-xl" : "text-4xl",
              "leading-none font-semibold tracking-tight",
              silent !== null && "opacity-60",
            ]}
          >
            {#if node?.leadEstimated}<span
                class="me-1 font-normal text-muted-foreground"
                title={m.detail_estimated()}
                aria-label={m.detail_estimated()}>≈</span
              >{/if}<AnimatedNumber
              value={loading || watts === null ? null : Math.abs(watts) / 1000}
            />
            <span class={[spec.today ? "text-sm" : "text-lg", "font-medium text-muted-foreground"]}
              >kW</span
            >
          </span>
          <!-- The label stops claiming "now" the moment the readings do. -->
          {#if silent !== null}
            <span class="mt-1 text-xs text-warning">{m.detail_last({ age: ago(silent) })}</span>
          {:else}
            <span class="mt-1 text-xs text-muted-foreground">{nowLine}</span>
          {/if}
        </p>
      {:else if shown.lead}
        <p class="flex flex-col">
          {@render fact(shown.lead, true)}
          <span class="mt-1 text-xs text-muted-foreground">{shown.lead.label}</span>
        </p>
      {/if}
    </div>
  </header>

  {#if power}
    <LiveSection {spec} {title} points={node?.points ?? []} {silent} {status} />
  {/if}

  <Readings {node} {status} {onopen} />

  {#if spec.chart}
    <DayFigure chart={spec.chart} {day} />
  {/if}

  {#if shown.stats.length > 0}
    <dl class="grid grid-cols-3 divide-x divide-border/60 border-t border-border/60">
      {#each shown.stats as s (s.label)}
        <div class="flex min-w-0 flex-col gap-0.5 px-5 py-3 first:sm:pl-6">
          <dt class="truncate text-xs text-muted-foreground">{s.label}</dt>
          <dd class="truncate tabular-nums">{@render fact(s, false)}</dd>
        </div>
      {/each}
    </dl>
  {/if}

  <!-- The sheet's one way onward, at the end where the scan ends: History at the sheet's range. -->
  <a
    href="#/history?range=day"
    class="group mt-auto flex items-center justify-between gap-3 border-t border-border/60 px-5 py-4 text-left text-sm font-medium text-brand outline-none transition-colors hover:bg-foreground/[0.04] focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset sm:px-6"
  >
    {m.detail_history({ range: m.detail_range_today() })}
    <ArrowRight class="size-4 transition-transform group-hover:translate-x-0.5" />
  </a>
</div>
