<!-- A detail sheet's header: the figure's name, its figure over the range, then on the right a
  second figure over the range, its live power or its lead fact. -->
<script lang="ts">
  import BesideFigure from "./BesideFigure.svelte";
  import DetailPower from "./DetailPower.svelte";
  import FactValue from "./FactValue.svelte";
  import type { Fact, Figure } from "./figures.ts";
  import type { HeadView } from "./head.svelte.ts";
  import HeadFigure from "./HeadFigure.svelte";
  import type { NodeReadings } from "./readings.ts";

  let {
    title,
    spec,
    node,
    status,
    head,
    beside,
    lead,
  }: {
    title: string;
    spec: Figure;
    node: NodeReadings | null;
    status: "loading" | "live" | "stopped";
    /** The figure over the sheet's range; null for a sheet that reads none. */
    head: HeadView | null;
    /** A second figure over the range, in place of the live power; null for none. */
    beside: HeadView | null;
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
  <!-- A sheet whose days head with their own figures has its name alone. -->
  {#if head || spec.node !== null || lead}
    <div class="flex items-end justify-between gap-4">
      {#if head}
        <HeadFigure view={head} estimated={node?.leadEstimated ?? false} />
      {/if}
      {#if beside}
        <BesideFigure view={beside} />
      {:else if spec.node !== null}
        <DetailPower {spec} {node} loading={status === "loading"} second={head !== null} />
      {:else if lead}
        <p class="flex flex-col">
          <FactValue fact={lead} big />
          <span class="mt-1 text-xs text-muted-foreground">{lead.label}</span>
        </p>
      {/if}
    </div>
  {/if}
</header>
