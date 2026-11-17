<!--
  A power figure's live graph in its detail sheet (ADR 21): the last two minutes of the figure,
  right after it and before the readings. A silent device or a halted stream parks and dims it. The
  header reads the sample under the pointer (ADR 21 "Chart reading").
-->
<script lang="ts">
  import { Skeleton } from "#lib/components/ui/skeleton/index.js";
  import LiveArea, { type LiveReading } from "../live-graph/LiveArea.svelte";
  import type { LivePoint } from "../live-graph/series.ts";
  import { stream } from "../live/stream.svelte.ts";
  import { motion } from "../motion/tier.svelte.ts";
  import { m } from "../paraglide/messages.js";
  import { formatPower } from "../power.ts";
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

  const height = $derived(input.shell === "bar" ? 128 : 150);
</script>

<section
  class="flex flex-col gap-1 border-t border-border/60 px-5 pt-3 pb-4 sm:px-6"
  aria-label={m.detail_live_region()}
>
  {#snippet legend(read: LiveReading | null)}
    <!-- The axis writes each tick's unit (lib/power.ts). -->
    <div class="flex items-baseline justify-between gap-3 text-xs text-muted-foreground">
      {#if read}
        <span class="font-medium text-foreground tabular-nums">{ago(read.ago)}</span>
        <span class="font-semibold text-foreground tabular-nums"
          >{read.watts === null ? "–" : formatPower(read.watts)}</span
        >
      {:else}
        <span class={["font-medium", halt !== null && "text-warning"]}>
          {halt ?? m.detail_live()}
        </span>
      {/if}
    </div>
  {/snippet}

  {#if points.length === 0 && status === "loading"}
    {@render legend(null)}
    <Skeleton style="height: {height}px" role="status" aria-label={m.loading()} />
  {:else if points.length === 0}
    {@render legend(null)}
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
      {legend}
    />
  {/if}
</section>
