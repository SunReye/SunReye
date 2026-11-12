<!--
  The one figure the dashboard leads with (ADR 21): PV power while PV produces, house consumption
  while it is idle. Over the scene it adds what the scene's chips do not carry: the house and the
  grid.
-->
<script lang="ts">
  import TriangleAlert from "@lucide/svelte/icons/triangle-alert";
  import Unplug from "@lucide/svelte/icons/unplug";
  import type { Live } from "../api/core.ts";
  import AnimatedNumber from "../components/animated-number.svelte";
  import { problemText } from "../i18n/problems.ts";
  import { m } from "../paraglide/messages.js";
  import { headline } from "./now.ts";

  let {
    live,
    plant,
    plantStale,
    figures,
    onselect,
    height = $bindable(0),
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
  } = $props();

  const lead = $derived(headline(plant));
  const refused = $derived(live !== undefined && "problem" in live ? live.problem : null);
  const producing = $derived(lead.subject === "production");
  const subject = $derived(producing ? m.dash_production() : m.dash_consumption());

  /** When the headline's series was last read, while it is stale. */
  const staleSince = $derived(plantStale?.[producing ? "pv.power" : "load.power"]);

  function age(since: number): string {
    const seconds = Math.max(Math.round((Date.now() - since) / 1000), 0);

    return seconds < 90 ? `${seconds} s` : `${Math.round(seconds / 60)} min`;
  }

  const kw = (watts: number | undefined) => (watts === undefined ? null : watts / 1000);
  const grid = $derived(plant?.["grid.power"]);
  const battery = $derived(plant?.["battery.power"]);
  const exporting = $derived(grid !== undefined && grid < 0);

  const figure =
    "rounded-sm outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring";
</script>

<div
  class="pointer-events-none absolute top-0 left-0 flex max-w-[calc(100%-7.5rem)] flex-col p-4"
  bind:clientHeight={height}
>
  <!-- The label stops claiming "now" the moment the stream does (ADR 21). -->
  {#if staleSince !== undefined}
    <span class="flex items-center gap-1.5 text-xs font-medium text-warning" role="status"
      ><TriangleAlert class="size-3.5 shrink-0" />{m.dash_lead_stalled({
        subject,
        age: age(staleSince),
      })}</span
    >
  {:else if refused !== null}
    <span class="flex items-center gap-1.5 text-xs font-medium text-destructive" role="alert"
      ><Unplug class="size-3.5 shrink-0" />{m.dash_lead_offline({ subject })} · {problemText(
        refused,
      )}</span
    >
  {:else if live === undefined}
    <span class="text-xs font-medium text-muted-foreground" role="status"
      >{m.dash_connecting()}</span
    >
  {:else}
    <span class="text-xs font-medium text-muted-foreground">{m.dash_lead_now({ subject })}</span>
  {/if}
  <span
    class={[
      "text-gradient text-5xl leading-[1.1] font-semibold tracking-tight",
      (staleSince !== undefined || refused !== null) && "opacity-60",
    ]}
  >
    <AnimatedNumber value={lead.watts === null ? null : lead.watts / 1000} />
    <span class="text-2xl text-muted-foreground">kW</span>
  </span>
  {#if figures && plant !== undefined}
    <span
      class="pointer-events-auto mt-1.5 flex flex-wrap gap-x-4 gap-y-0.5 text-sm text-muted-foreground"
    >
      {#if producing}
        <button type="button" class={figure} onclick={() => onselect("house")}
          >{m.dash_house()}
          <span class="font-semibold text-foreground"
            ><AnimatedNumber value={kw(plant["load.power"])} /></span
          > kW</button
        >
      {:else if battery !== undefined}
        <button type="button" class={figure} onclick={() => onselect("battery")}
          >{m.dash_battery()}
          <span class="font-semibold text-battery"
            ><AnimatedNumber value={Math.abs(battery) / 1000} /></span
          > kW</button
        >
      {/if}
      {#if grid !== undefined}
        <button type="button" class={figure} onclick={() => onselect("grid")}>
          {exporting ? m.dash_grid_export() : m.dash_grid_import()}
          <span class={["font-semibold", exporting ? "text-export" : "text-import"]}
            ><AnimatedNumber value={Math.abs(grid) / 1000} /></span
          > kW
        </button>
      {/if}
    </span>
  {/if}
</div>
