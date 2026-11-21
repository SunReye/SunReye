<script lang="ts">
  import type { BiddingZone, Core, Problem, SpotPriceZone } from "../api/core";
  import ProblemAlert from "../components/problem-alert.svelte";
  import Segmented from "../components/segmented.svelte";
  import { m } from "../paraglide/messages.js";

  /** The zone in force, or why it was refused. */
  let { core, answer }: { core: Core; answer: SpotPriceZone | Problem } = $props();

  const id = $props.id();

  /** Every zone the core has a source for; one it gains fails the type check until listed. */
  const ZONES = Object.values({ "DE-LU": "DE-LU" } satisfies Record<BiddingZone, BiddingZone>);

  let refused = $state.raw<Problem>();

  const problem = $derived(refused ?? ("problem" in answer ? answer : undefined));

  /** The admin's pick, shown at once; "none" is no zone. */
  let picked = $state<string>();

  const zone = $derived(picked ?? ("zone" in answer ? (answer.zone ?? "none") : "none"));

  async function choose(next: string): Promise<void> {
    picked = next;
    refused = await core.setSpotZone(ZONES.find((option) => option === next) ?? null);

    // A refused pick falls back to the zone in force.
    if (refused) picked = undefined;
  }
</script>

<div class="flex items-center justify-between gap-3 border-y border-border/60 px-4 py-3 text-[15px]">
  <span id="{id}-zone">{m.tariff_zone()}</span>
  <div class="shrink-0">
    <Segmented
      options={[["none", m.tariff_zone_none()], ...ZONES.map((option) => [option, option] as const)]}
      value={zone}
      labelledby="{id}-zone"
      onchange={(next) => void choose(next)}
    />
  </div>
</div>
{#if problem}
  <div class="px-4 pt-2"><ProblemAlert problem={problem.problem} /></div>
{/if}
