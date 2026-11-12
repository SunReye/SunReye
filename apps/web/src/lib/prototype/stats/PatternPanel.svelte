<!-- PROTOTYPE: when in the day it happens: hour of day against the range's days, or its months when the range is long. Production for the energy view, grid purchase for autarky. -->
<script lang="ts">
  import HeatGrid from "./HeatGrid.svelte";
  import { heat } from "./query";
  import { num } from "./format";
  import type { Q } from "./route";

  let { q }: { q: Q } = $props();
  const spec = $derived(q.metric === "autarky" ? { field: "imp", name: "Netzbezug", colour: "var(--e-import)" } : { field: "pv", name: "Produktion", colour: "var(--e-solar)" });
  const data = $derived(heat(q.h, q.sel, spec.field));
  // One hue, light to dark; steps of a tenth so equal cells look equal.
  const fill = (v: number) => `color-mix(in oklab, ${spec.colour} ${Math.round(Math.min(1, v / (data.max || 1)) * 10) * 10}%, transparent)`;
</script>

<div class="flex flex-col gap-3">
  <HeatGrid
    cols={data.cols}
    cells={data.cells}
    colour={fill}
    describe={(v) => (v === null ? "keine Daten" : Number.isNaN(v) ? "noch nicht aufgezeichnet" : `${num(v, 2)} kWh${data.by === "month" ? " im Mittel" : ""}`)}
    idle={`${spec.name} je Stunde${data.by === "month" ? ", Monatsmittel" : q.sel.kind === "day" ? " in der Woche des Tages" : ""}`}
    label="{spec.name} nach Tageszeit"
    drillLabel={data.by === "month" ? "Monat öffnen" : "Tag öffnen"}
    ondrill={(c) => data.cols[c]!.drill && q.open(data.cols[c]!.drill!)}
  />
  <div class="flex items-center gap-2 pl-10 text-xs text-muted-foreground tabular-nums">
    <span>0</span>
    <span class="flex h-2 w-32 gap-px">{#each { length: 10 } as _, i (i)}<span class="flex-1" style:background={fill(((i + 1) / 10) * data.max)}></span>{/each}</span>
    <span>{num(data.max, 1)} kWh je Stunde</span>
    <span class="ml-3 flex items-center gap-1.5"><span class="hatch size-2.5"></span>keine Daten</span>
  </div>
</div>

<style>
  .hatch {
    background: repeating-linear-gradient(135deg, color-mix(in oklab, var(--foreground) 30%, transparent) 0 1px, transparent 1px 4px);
  }
</style>
