<!--
  A power figure's live graph in its detail sheet (ADR 21): the last two minutes of the figure,
  right after it and before the readings. A silent device or a halted stream parks and dims it. The
  header reads the sample under the pointer (ADR 21 "Chart reading").
-->
<script lang="ts">
  import { Skeleton } from "#lib/components/ui/skeleton/index.js";
  import LiveArea from "../live-graph/LiveArea.svelte";
  import LiveLegend from "../live-graph/LiveLegend.svelte";
  import type { LivePoint } from "../live-graph/series.ts";
  import { stream } from "../live/stream.svelte.ts";
  import { motion } from "../motion/tier.svelte.ts";
  import { m } from "../paraglide/messages.js";
  import { input } from "../shell/input.svelte.ts";
  import type { Figure } from "./figures.ts";
  import { ago } from "./readings.ts";

  let {
    spec,
    points,
    silent,
    status,
  }: {
    spec: Figure;
    points: readonly LivePoint[];
    /** Seconds the figure's device has been silent; null while it answers. */
    silent: number | null;
    status: "loading" | "live" | "stopped";
  } = $props();

  /** Why the graph is not current, when it is not. */
  const halt = $derived.by(() => {
    if (silent !== null) return m.detail_silent({ age: ago(silent) });

    return status === "stopped" || stream.halted ? m.detail_stopped() : null;
  });

  const label = $derived(halt ?? m.detail_live());

  const height = $derived(input.shell === "bar" ? 128 : 150);
</script>

<section
  class="flex flex-col gap-1 border-t border-border/60 px-5 pt-3 pb-4 sm:px-6"
  aria-label={m.detail_live_region()}
>
  {#if points.length === 0 && status === "loading"}
    <LiveLegend reading={null} {label} warn={halt !== null} />
    <Skeleton style="height: {height}px" role="status" aria-label={m.loading()} />
  {:else if points.length === 0}
    <LiveLegend reading={null} {label} warn={halt !== null} />
    <!-- The plot's place is held: nothing below it moves when the device answers again. -->
    <p
      class="flex items-center justify-center text-xs text-muted-foreground"
      style:height="{height}px"
    >
      {m.detail_live_none()}
    </p>
  {:else}
    <LiveArea
      {points}
      accent={spec.diverging?.[0] ?? spec.colour}
      below={spec.diverging?.[1] ?? spec.colour}
      diverging={spec.diverging !== undefined}
      {height}
      stalled={halt !== null}
      still={motion.still}
      {label}
    />
  {/if}
</section>
