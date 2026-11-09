<script lang="ts">
  import type { BiddingZone, Core, Problem, SpotPriceZone } from "../api/core";
  import { problemText } from "../i18n/problems";
  import { m } from "../paraglide/messages.js";

  /** The zone in force, or why it was refused. */
  let { core, answer }: { core: Core; answer: SpotPriceZone | Problem } = $props();

  const id = $props.id();

  /** Every zone the core has a source for; one it gains fails the type check until listed. */
  const ZONES = Object.values({ "DE-LU": "DE-LU" } satisfies Record<BiddingZone, BiddingZone>);

  let refused = $state.raw<Problem>();

  const problem = $derived(refused ?? ("problem" in answer ? answer : undefined));

  const zone = $derived("zone" in answer ? (answer.zone ?? "") : "");

  async function choose(event: Event & { currentTarget: HTMLSelectElement }): Promise<void> {
    const { value } = event.currentTarget;

    refused = await core.setSpotZone(ZONES.find((option) => option === value) ?? null);
  }
</script>

<label for="{id}-zone">{m.tariff_zone()}</label>
<select id="{id}-zone" value={zone} onchange={choose}>
  <option value="">{m.tariff_zone_none()}</option>
  {#each ZONES as option (option)}
    <option value={option}>{option}</option>
  {/each}
</select>
{#if problem}
  <p role="alert">{problemText(problem.problem)}</p>
{/if}
