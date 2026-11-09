<script lang="ts">
  import type { Core } from "../api/core";
  import { problemText } from "../i18n/problems";
  import { m } from "../paraglide/messages.js";
  import InvestmentForm from "./InvestmentForm.svelte";
  import PaybackFigures from "./PaybackFigures.svelte";

  let { core }: { core: Core } = $props();

  const id = $props.id();

  // Read again once the admin enters an investment.
  let payback = $derived(core.payback());
</script>

<section aria-labelledby="{id}-title">
  <h2 id="{id}-title">{m.tariff_payback()}</h2>
  {#await payback then answer}
    {#if "problem" in answer}
      <p role="alert">{problemText(answer.problem)}</p>
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
</section>
