<!--
  The canvas's one status line (ADR 20): where the powers come from, each string's power, the
  connected cars and a missing location. It never wraps or grows: what does not fit scrolls sideways.
-->
<script lang="ts">
  import MapPinOff from "@lucide/svelte/icons/map-pin-off";
  import type { Device, StringDraft } from "../api/core.ts";
  import type { Parked } from "@sunreye/builder/cars/parked.ts";
  import { m } from "../paraglide/messages.js";
  import CarNotes from "./CarNotes.svelte";
  import type { Source } from "./moment.ts";
  import StringPowers from "./StringPowers.svelte";

  let {
    strings,
    watts,
    source,
    cars,
    devices,
    located,
  }: {
    strings: readonly StringDraft[];
    /** By string position; null where it is dark or unknown. */
    watts: readonly (number | null)[];
    /** Undefined while the day loads. */
    source: Source | undefined;
    cars: readonly Parked[];
    devices: readonly Device[];
    /** Whether the plant's location is known: without it the sun stays put. */
    located: boolean;
  } = $props();

  const shown = $derived(strings.length > 0 || cars.length > 0 || !located);
</script>

{#if shown}
  <div
    role="group"
    data-canvas-zone
    aria-label={m.builder_status()}
    class="canvas-chip pointer-events-auto flex h-9 max-w-full min-w-0 rounded-md pl-2.5 text-xs text-muted-foreground ring-1 ring-border/60 elevation-1"
  >
    <div
      class="flex min-w-0 items-center gap-3 overflow-x-auto pr-2.5 whitespace-nowrap scroll-fade-x no-scrollbar"
    >
      <StringPowers {strings} {watts} {source} />
      <CarNotes {cars} {devices} />
      {#if !located}
        <div class="flex shrink-0 items-center gap-1.5">
          <MapPinOff class="size-3.5" />
          <p>{m.builder_no_location()}</p>
        </div>
      {/if}
    </div>
  </div>
{/if}
