<!-- The range's answer: four figures, each the door to its own view (ADR 21). -->
<script lang="ts">
  import { Pressable } from "../components/ui/pressable/index.js";
  import CircleCheck from "@lucide/svelte/icons/circle-check";
  import TriangleAlert from "@lucide/svelte/icons/triangle-alert";
  import FigureNumber from "./FigureNumber.svelte";
  import { haptics } from "../haptics.ts";
  import { m } from "../paraglide/messages.js";
  import { indicator } from "../range/indicator.ts";
  import type { Figure, PlantState } from "./answer.ts";
  import type { Metric } from "./view.ts";
  import { delta } from "./words.ts";

  let {
    figures,
    plant,
    metric,
    against,
    quiet,
    onpick,
  }: {
    figures: readonly Figure[];
    plant: PlantState;
    metric: Metric;
    /** "zum Vormonat"; empty without a baseline. */
    against: string;
    /** Loading or failed: the figures show dashes. */
    quiet: boolean;
    onpick: (metric: Metric) => void;
  } = $props();

  function pick(id: Metric): void {
    if (id === metric) return;

    haptics.selection();
    onpick(id);
  }

  const unitClass =
    "text-[10px] font-medium tracking-normal text-muted-foreground @[640px]:text-sm";

  /** A figure tab: the pressable gives it its focus ring and fade. */
  const FIGURE =
    "relative flex min-w-0 flex-col items-start gap-1 px-2 py-3 text-left sm:px-4";
</script>

<div
  class="relative grid grid-cols-4 divide-x divide-border/60 border-b border-border/60"
  role="tablist"
  aria-label={m.stats_figures()}
>
  {#each figures as f (f.id)}
    {@const on = metric === f.id}
    <Pressable
      role="tab"
      aria-selected={on}
      feedback
      class={[FIGURE, on && "bg-foreground/[0.05] hover:bg-foreground/[0.07]"]}
      onclick={() => {
        pick(f.id);
      }}
    >
      <span class={["label", on ? "text-foreground" : "text-muted-foreground"]}>{f.label}</span>
      <span class="value">
        <FigureNumber
          value={quiet ? null : f.value}
          format={f.format}
          placeholder="–"
          appear={false}
        />
        <span class={unitClass}>{f.unit}</span>
      </span>
      <span class="max-w-full truncate text-xs text-muted-foreground tabular-nums">
        {#if !quiet && against && f.change !== null}
          <span class="font-medium text-foreground"
            ><FigureNumber
              value={f.change}
              format={(v) => delta(v, f.points)}
              appear={false}
            /></span
          ><span class="hidden @[640px]:inline">{" "}{against}</span>
        {:else}&nbsp;{/if}
      </span>
    </Pressable>
  {/each}
  {@render plantFigure()}
  <!-- Which view is open: the brand marks the control, never the data. -->
  <span class="bg-brand" {@attach indicator('[aria-selected="true"]', 2)}></span>
</div>

{#snippet plantFigure()}
  {@const on = metric === "plant"}
  {@const shown = !quiet && !plant.learning}
  <Pressable
    role="tab"
    aria-selected={on}
    feedback
      class={[FIGURE, on && "bg-foreground/[0.05] hover:bg-foreground/[0.07]"]}
    onclick={() => {
      pick("plant");
    }}
  >
    <span class={["label", on ? "text-foreground" : "text-muted-foreground"]}
      >{m.stats_plant()}</span
    >
    <span class="value">
      {#if shown && plant.weak > 0}
        <TriangleAlert class="size-4 shrink-0 self-center text-warning @[640px]:size-5" />
        {plant.weak}
        <span class={unitClass}>{m.stats_notices()}</span>
      {:else if shown}
        <CircleCheck class="size-4 shrink-0 self-center text-success @[640px]:size-5" />
        {m.stats_plant_ok()}
      {:else if !quiet && plant.learning}
        <!-- Too few days to judge a string: said, where a dash read as a missing value. -->
        {m.stats_plant_learning()}
      {:else}
        –
      {/if}
    </span>
    <span class="max-w-full truncate text-xs text-muted-foreground">
      <span class="@[640px]:hidden">{m.stats_plant_short()}</span><span
        class="hidden @[640px]:inline"
        >{plant.battery ? m.stats_plant_sub_battery() : m.stats_plant_sub()}</span
      >
    </span>
  </Pressable>
{/snippet}

<style>
  .label {
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 0.75rem;
    font-weight: 500;
  }
  .value {
    display: flex;
    max-width: 100%;
    align-items: baseline;
    gap: 0.25rem;
    font-size: 1.125rem;
    line-height: 1;
    font-weight: 600;
    letter-spacing: -0.025em;
    white-space: nowrap;
    font-variant-numeric: tabular-nums;
  }
  @container (width >= 640px) {
    .value {
      font-size: 1.875rem;
    }
  }
</style>
