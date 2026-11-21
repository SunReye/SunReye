<!-- Stored value: every day moves this bar (ADR 12). It opens the payback tab. -->
<script lang="ts">
  import * as Card from "#lib/components/ui/card/index.js";
  import { Progress } from "#lib/components/ui/progress/index.js";
  import FigureNumber from "./FigureNumber.svelte";
  import type { Payback } from "../api/tariff.ts";
  import { m } from "../paraglide/messages.js";
  import { money, num } from "../range/format.ts";
  import { paybackShare, reachedYear } from "./payback.ts";

  let {
    payback,
    loading,
    tucked,
    onopen,
  }: { payback: Payback; loading: boolean; tucked: boolean; onopen: () => void } = $props();

  const share = $derived(paybackShare(payback));
  const year = $derived(reachedYear(payback));
</script>

<div class={["tuck", tucked && "tucked"]} inert={tucked}>
  <Card.Root interactive class="w-full gap-2 px-4 py-3" onclick={onopen}>
    <span class="flex w-full items-baseline justify-between gap-2">
      <span class="text-sm font-semibold">{m.stats_payback()}</span>
      <span class="text-sm font-semibold tabular-nums"
        ><FigureNumber
          value={loading ? null : share}
          format={(v) => `${num(v * 100)} %`}
          placeholder="–"
          appear={false}
        /></span
      >
    </span>
    <Progress
      value={loading || share === null ? 0 : share * 100}
      size="square"
      class="payback"
      aria-label={m.stats_payback()}
    />
    <span class="text-xs text-muted-foreground tabular-nums">
      {#if payback.investment == null}
        {m.stats_payback_none()}
      {:else}
        {@const amounts = { saved: money(payback.savings), investment: money(payback.investment) }}
        {year === null
          ? m.stats_payback_saved(amounts)
          : m.stats_payback_saved_until({ ...amounts, year: String(year) })}
      {/if}
    </span>
  </Card.Root>
</div>

<style>
  .tuck {
    transition: opacity var(--motion-base) var(--motion-ease);
  }
  .tucked {
    opacity: 0;
    transition: opacity var(--motion-exit) var(--motion-ease-exit);
  }
  :global(.payback > [data-slot="progress-indicator"]) {
    background: var(--e-solar);
  }
</style>
