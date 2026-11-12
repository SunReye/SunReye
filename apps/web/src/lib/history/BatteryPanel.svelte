<!--
  The battery over the range: what it took in and gave back. Its usable capacity needs the core to
  infer it from the state of charge (there is no vendor health register); until then it says so.
-->
<script lang="ts">
  import { m } from "../paraglide/messages.js";
  import { kwh, num } from "../range/format.ts";
  import type { Sum } from "./flows.ts";

  let { sum, loading }: { sum: Sum; loading: boolean } = $props();

  const cells = $derived([
    [m.stats_battery_charge(), kwh(sum.charge)],
    [m.stats_battery_discharge(), kwh(sum.discharge)],
    [
      m.stats_battery_share(),
      sum.consumption > 0 ? `${num((sum.discharge / sum.consumption) * 100)} %` : "–",
    ],
  ] as const);
</script>

<div class="flex min-h-[300px] flex-col gap-4">
  <dl class="grid grid-cols-3 divide-x divide-border/60 border-y border-border/60">
    {#each cells as [k, v], i (k)}
      <div class={["flex min-w-0 flex-col gap-0.5 py-2.5", i > 0 && "pl-3", i < 2 && "pr-3"]}>
        <dt class="truncate text-xs text-muted-foreground">{k}</dt>
        <dd class="text-base font-semibold whitespace-nowrap tabular-nums">{loading ? "–" : v}</dd>
      </div>
    {/each}
  </dl>
  <div class="flex min-h-[200px] flex-col justify-center gap-2">
    <h3 class="text-base font-semibold">{m.stats_battery_health()}</h3>
    <p class="max-w-[52ch] text-sm text-muted-foreground">{m.stats_battery_health_text()}</p>
  </div>
</div>
