<!-- The battery's usable capacity and cycles, inferred by the core from the state of charge: there is no vendor health register (ADR 4). -->
<script lang="ts">
  import type { Core } from "../api/core.ts";
  import type { Capacity } from "../api/records.ts";
  import { m } from "../paraglide/messages.js";
  import { kwh, num } from "../range/format.ts";
  import { capacityCells, capacityRows } from "./battery.ts";
  import type { Sum } from "./flows.ts";
  import TrendChart from "./TrendChart.svelte";

  let {
    core,
    sum,
    end,
    zone,
    loading,
    height,
  }: {
    core: Readonly<Pick<Core, "batteryCapacity">>;
    sum: Sum;
    /** The range's first day after it. */
    end: number;
    zone: string;
    loading: boolean;
    height: number;
  } = $props();

  let capacity = $state.raw<Capacity | null>(null);

  $effect(() => {
    let live = true;

    void core.batteryCapacity().then((read) => {
      if (live && !("problem" in read)) capacity = read;

      return read;
    });

    return () => {
      live = false;
    };
  });

  const cells = $derived(
    capacity ? capacityCells(capacity, { discharge: sum.discharge, end }, zone) : [],
  );

  const rows = $derived(capacity ? capacityRows(capacity, zone) : []);

  const nameplate = $derived(capacity?.nameplate ?? null);
</script>

<div class="flex flex-col gap-4">
  <dl
    class="grid grid-cols-2 border-y border-border/60 @[640px]:grid-cols-4 @[640px]:divide-x @[640px]:divide-border/60"
  >
    {#each cells as c, i (c.key)}
      <div
        class={[
          "flex min-w-0 flex-col gap-0.5 py-2.5 @[640px]:px-3 @[640px]:first:pl-0",
          i % 2 === 1 && "pl-3",
          i > 1 && "border-t border-border/60 @[640px]:border-t-0",
        ]}
      >
        <dt class="truncate text-xs text-muted-foreground">{c.key}</dt>
        <dd class="text-base font-semibold whitespace-nowrap tabular-nums">
          {loading ? "–" : c.value}
        </dd>
        <dd class="text-xs text-muted-foreground tabular-nums">{c.sub}</dd>
      </div>
    {/each}
  </dl>
  {#if rows.length > 1}
    <TrendChart
      {rows}
      series={[
        {
          key: "kwh",
          label: m.stats_capacity_point(),
          colour: "var(--e-battery)",
          kind: "points",
        },
        { key: "trend", label: m.stats_capacity_trend(), colour: "var(--e-battery)", kind: "line" },
      ]}
      rules={nameplate === null ? [] : [{ y: nameplate, label: m.stats_capacity_nameplate() }]}
      fmt={kwh}
      axisFmt={(v) => num(v, 1)}
      unit="kWh"
      yMin={null}
      {height}
      label={m.stats_capacity_chart()}
    />
  {:else if capacity}
    <div class="flex min-h-[200px] flex-col justify-center gap-2">
      <h3 class="text-base font-semibold">{m.stats_battery_health()}</h3>
      <p class="max-w-[52ch] text-sm text-muted-foreground">{m.stats_battery_health_text()}</p>
    </div>
  {:else}
    <div class="min-h-[200px]"></div>
  {/if}
  <p class="max-w-[68ch] text-xs text-muted-foreground">{m.stats_capacity_note()}</p>
</div>
