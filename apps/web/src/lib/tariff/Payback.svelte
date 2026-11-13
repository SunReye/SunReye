<script lang="ts">
  import Section from "../components/section.svelte";
  import ProblemAlert from "../components/problem-alert.svelte";
  import type { Core } from "../api/core";
  import { m } from "../paraglide/messages.js";
  import LoadingRows from "../components/loading-rows.svelte";
  import InvestmentForm from "./InvestmentForm.svelte";
  import PaybackFigures from "./PaybackFigures.svelte";

  let { core }: { core: Core } = $props();

  // Read again once the admin enters an investment.
  let payback = $derived(core.payback());
</script>

<Section title={m.tariff_payback()}>
  {#await payback}
    <LoadingRows />
  {:then answer}
    {#if "problem" in answer}
      <ProblemAlert problem={answer.problem} />
    {:else}
      <PaybackFigures payback={answer} />
      <InvestmentForm
        {core}
        oninvested={() => {
          payback = core.payback();
        }}
      />
    {/if}
  {/await}
</Section>
