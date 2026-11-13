<!-- The range's answer: four figures, each the door to its own view (ADR 21). -->
<script lang="ts">
  import CircleCheck from "@lucide/svelte/icons/circle-check";
  import TriangleAlert from "@lucide/svelte/icons/triangle-alert";
  import AnimatedNumber from "../components/animated-number.svelte";
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
</script>

<div
  class="relative grid grid-cols-4 divide-x divide-border/60 border-b border-border/60"
  role="tablist"
  aria-label={m.stats_figures()}
>
  {#each figures as f (f.id)}
    {@const on = metric === f.id}
    <button
      type="button"
      role="tab"
      aria-selected={on}
      class={["figure", on && "on"]}
      onclick={() => {
        pick(f.id);
      }}
    >
      <span class={["label", on ? "text-foreground" : "text-muted-foreground"]}>{f.label}</span>
      <span class="value">
        <AnimatedNumber
          value={quiet ? null : f.value}
          format={f.format}
          placeholder="–"
          duration={320}
          appear={false}
        />
        <span class={unitClass}>{f.unit}</span>
      </span>
      <span class="max-w-full truncate text-xs text-muted-foreground tabular-nums">
        {#if !quiet && against && f.change !== null}
          <span class="font-medium text-foreground"
            ><AnimatedNumber
              value={f.change}
              format={(v) => delta(v, f.points)}
              duration={320}
              appear={false}
            /></span
          ><span class="hidden @[640px]:inline">{" "}{against}</span>
        {:else}&nbsp;{/if}
      </span>
    </button>
  {/each}
  {@render plantFigure()}
  <!-- Which view is open: the brand marks the control, never the data. -->
  <span class="bg-brand" {@attach indicator('[aria-selected="true"]', 2)}></span>
</div>

{#snippet plantFigure()}
  {@const on = metric === "plant"}
  {@const shown = !quiet && !plant.learning}
  <button
    type="button"
    role="tab"
    aria-selected={on}
    class={["figure", on && "on"]}
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
  </button>
{/snippet}

<style>
  .figure {
    position: relative;
    display: flex;
    min-width: 0;
    flex-direction: column;
    align-items: flex-start;
    gap: 0.25rem;
    padding: 0.75rem 0.5rem;
    text-align: left;
    outline: none;
    transition: background-color 120ms var(--motion-ease);
  }
  @media (width >= 40rem) {
    .figure {
      padding-inline: 1rem;
    }
  }
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
  .figure.on {
    background-color: color-mix(in oklab, var(--foreground) 5%, transparent);
  }
  .figure:hover {
    background-color: color-mix(in oklab, var(--foreground) 4%, transparent);
  }
  .figure.on:hover {
    background-color: color-mix(in oklab, var(--foreground) 7%, transparent);
  }
  .figure:active {
    background-color: color-mix(in oklab, var(--foreground) 8%, transparent);
  }
  .figure:focus-visible {
    box-shadow: inset 0 0 0 2px var(--ring);
  }
  :global([data-motion="still"]) .figure {
    transition: none;
  }
</style>
