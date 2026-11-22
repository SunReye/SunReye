<!--
  The one figure the dashboard leads with (ADR 21): PV power while PV produces, house consumption
  while it is idle. Over the scene it adds what the scene's chips do not carry: the house and the
  grid.
-->
<script lang="ts">
  import type { Live } from "../api/core.ts";
  import LoadFailed from "../components/load-failed.svelte";
  import PowerNumber from "../components/power-number.svelte";
  import { m } from "../paraglide/messages.js";
  import HeadlineFigures from "./HeadlineFigures.svelte";
  import HeadlineStatus from "./HeadlineStatus.svelte";
  import { headline } from "./now.ts";

  let {
    live,
    plant,
    plantStale,
    figures,
    onselect,
    height = $bindable(0),
    onretry,
  }: {
    /** Undefined until the stream first answers. */
    live: Live | undefined;
    /** The `plant` device's values (ADR 14). */
    plant: Readonly<Record<string, number>> | undefined;
    /** When each of its stale values was last read. */
    plantStale: Readonly<Record<string, number>> | undefined;
    /** Whether the house and grid figures show: the 2D flow carries them itself. */
    figures: boolean;
    onselect: (id: string) => void;
    /** Pixels it takes, so the flow below starts clear of it. */
    height?: number;
    /** Loads the 3D scene again, while it has failed: said in a quiet note under the figures. */
    onretry?: (() => void) | undefined;
  } = $props();

  const lead = $derived(headline(plant));
  const refused = $derived(live !== undefined && "problem" in live ? live.problem : null);
  const lost = $derived(live !== undefined && "devices" in live && live.lost !== undefined);
  const producing = $derived(lead.subject === "production");
  const subject = $derived(producing ? m.dash_production() : m.dash_consumption());

  /** When the headline's series was last read, while it is stale. */
  const staleSince = $derived(plantStale?.[producing ? "pv.power" : "load.power"]);
</script>

<div
  class="pointer-events-none absolute top-0 left-0 flex max-w-[calc(100%-7.5rem)] flex-col p-4"
  bind:clientHeight={height}
>
  <HeadlineStatus {subject} {staleSince} {lost} {refused} connecting={live === undefined} />
  <span
    class={[
      "text-gradient text-5xl leading-[1.1] font-semibold tracking-tight",
      (staleSince !== undefined || lost || refused !== null) && "opacity-60",
    ]}
  >
    <PowerNumber watts={lead.watts} unitClass="text-2xl text-muted-foreground" />
  </span>
  {#if figures && plant !== undefined}
    <HeadlineFigures {plant} {producing} {onselect} />
  {/if}
  {#if onretry}
    <!-- Quiet, beside the figure it does not change: the flow below serves without the 3D scene. -->
    <LoadFailed
      size="quiet"
      class="pointer-events-auto mt-1.5"
      text={m.dash_scene_failed()}
      {onretry}
    />
  {/if}
</div>
