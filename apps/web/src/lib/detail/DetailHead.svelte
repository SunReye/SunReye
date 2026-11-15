<!-- A detail sheet's header: the figure's name, today's energy, its live power or its lead fact. -->
<script lang="ts">
  import type { Day } from "../dashboard/day.ts";
  import { m } from "../paraglide/messages.js";
  import DetailPower from "./DetailPower.svelte";
  import FactValue from "./FactValue.svelte";
  import type { Fact, Figure } from "./figures.ts";
  import Quantity from "./Quantity.svelte";
  import type { NodeReadings } from "./readings.ts";

  let {
    title,
    spec,
    node,
    status,
    day,
    lead,
  }: {
    title: string;
    spec: Figure;
    node: NodeReadings | null;
    status: "loading" | "live" | "stopped";
    day: Day | undefined;
    lead: Fact | null;
  } = $props();

  /** A signed grid power takes the side of its diverging pair: import above zero, export below. */
  const colour = $derived(
    spec.direction === "grid" && spec.diverging !== undefined
      ? spec.diverging[(node?.lead ?? 0) >= 0 ? 0 : 1]
      : spec.colour,
  );
</script>

<header class="flex flex-col gap-3 px-5 pt-5 pb-4 sm:px-6">
  <h2 class="flex items-baseline gap-2 pr-10 text-base font-semibold">
    <span class="size-2 shrink-0 -translate-y-px rounded-[1px]" style:background={colour}></span>
    <span class="line-clamp-2 min-w-0 break-words">{title}</span>
  </h2>
  <div class="flex items-end justify-between gap-4">
    {#if spec.today}
      <p class="flex flex-col">
        <span class="text-4xl leading-none font-semibold tracking-tight"
          ><Quantity
            value={day?.today[spec.today] ?? null}
            unit="kWh"
            unitClass="text-lg font-medium text-muted-foreground"
          /></span
        >
        <span class="mt-1 text-xs text-muted-foreground">{m.detail_today()}</span>
      </p>
    {/if}
    {#if spec.node !== null}
      <DetailPower {spec} {node} loading={status === "loading"} />
    {:else if lead}
      <p class="flex flex-col">
        <FactValue fact={lead} big />
        <span class="mt-1 text-xs text-muted-foreground">{lead.label}</span>
      </p>
    {/if}
  </div>
</header>
