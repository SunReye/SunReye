<script lang="ts">
  import Section from "../components/section.svelte";
  import type { Core } from "../api/core";
  import ProblemAlert from "../components/problem-alert.svelte";
  import { m } from "../paraglide/messages.js";
  import LoadingRows from "../components/loading-rows.svelte";
  import InvestmentForm from "./InvestmentForm.svelte";
  import PaybackFigures from "./PaybackFigures.svelte";

  let { core }: { core: Core } = $props();


  // Read again once the admin enters an investment.
  let payback = $derived(core.payback());
</script>

<Section eyebrow title={m.tariff_payback()}>
  {#await payback}
    <LoadingRows />
  {:then answer}
    {#if "problem" in answer}
      <div class="p-4"><ProblemAlert problem={answer.problem} /></div>
    {:else}
      <div class="flex flex-col divide-y divide-border/60 border-y border-border/60">
        <InvestmentForm
          {core}
          investment={answer.investment ?? null}
          oninvested={() => {
            payback = core.payback();
          }}
        />
        <PaybackFigures payback={answer} />
      </div>
    {/if}
  {/await}
</Section>
