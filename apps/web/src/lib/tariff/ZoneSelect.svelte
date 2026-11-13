<script lang="ts">
  import ProblemAlert from "../components/problem-alert.svelte";
  import * as ToggleGroup from "#lib/components/ui/toggle-group/index.js";
  import type { BiddingZone, Core, Problem, SpotPriceZone } from "../api/core";
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

  /** Pressing the zone in force again deselects nothing: it stays. */
  async function choose(next: string): Promise<void> {
    if (next === "" || next === zone) return;

    picked = next;
    refused = await core.setSpotZone(ZONES.find((option) => option === next) ?? null);

    // A refused pick falls back to the zone in force.
    if (refused) picked = undefined;
  }
</script>

<div class="flex flex-col gap-1.5 text-sm">
  <span id="{id}-zone">{m.tariff_zone()}</span>
  <ToggleGroup.Root
    type="single"
    variant="outline"
    bind:value={() => zone, (next) => void choose(next)}
    aria-labelledby="{id}-zone"
    class="self-start"
  >
    <ToggleGroup.Item value="none" class="px-4">{m.tariff_zone_none()}</ToggleGroup.Item>
    {#each ZONES as option (option)}
      <ToggleGroup.Item value={option} class="px-4">{option}</ToggleGroup.Item>
    {/each}
  </ToggleGroup.Root>
</div>
{#if problem}
  <ProblemAlert problem={problem.problem} />
{/if}
