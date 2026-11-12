<!-- Stored value: every day moves this bar (ADR 12). It opens the payback tab. -->
<script lang="ts">
  import { Progress } from "#lib/components/ui/progress/index.js";
  import AnimatedNumber from "../AnimatedNumber.svelte";
  import type { Payback } from "../api/tariff.ts";
  import { m } from "../paraglide/messages.js";
  import { money, num } from "../range/format.ts";
  import { paybackShare } from "./payback.ts";

  let {
    payback,
    loading,
    tucked,
    onopen,
  }: { payback: Payback; loading: boolean; tucked: boolean; onopen: () => void } = $props();

  const share = $derived(paybackShare(payback));
</script>

<div class={["tuck", tucked && "tucked"]} inert={tucked}>
  <button
    type="button"
    class="glass-ambient flex w-full flex-col gap-2 rounded-lg px-4 py-3 text-left ring-1 ring-foreground/10 outline-none transition-shadow hover:ring-foreground/25 focus-visible:ring-2 focus-visible:ring-ring"
    onclick={onopen}
  >
    <span class="flex w-full items-baseline justify-between gap-2">
      <span class="text-sm font-semibold">{m.stats_payback()}</span>
      <span class="text-sm font-semibold tabular-nums"
        ><AnimatedNumber
          value={loading ? null : share}
          format={(v) => `${num(v * 100)} %`}
          placeholder="–"
          duration={320}
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
        {m.stats_payback_saved({
          saved: money(payback.savings),
          investment: money(payback.investment),
        })}
      {/if}
    </span>
  </button>
</div>

<style>
  .tuck {
    transition: opacity 200ms var(--motion-ease);
  }
  .tucked {
    opacity: 0;
    transition: opacity 150ms ease-in;
  }
  :global([data-motion="still"]) .tuck {
    transition: none;
  }
  :global(.payback > [data-slot="progress-indicator"]) {
    background: var(--e-solar);
  }
</style>
