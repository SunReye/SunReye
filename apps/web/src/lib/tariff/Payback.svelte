<script lang="ts">
  import type { Core } from "../api/core";
  import { problemText } from "../i18n/problems";
  import { m } from "../paraglide/messages.js";
  import LoadingRows from "../components/loading-rows.svelte";
  import InvestmentForm from "./InvestmentForm.svelte";
  import PaybackFigures from "./PaybackFigures.svelte";

  let { core }: { core: Core } = $props();

  const id = $props.id();

  // Read again once the admin enters an investment.
  let payback = $derived(core.payback());
</script>

<section aria-labelledby="{id}-title" class="flex flex-col">
  <h2
    id="{id}-title"
    class="px-4 pt-5 pb-2 text-xs font-medium tracking-wide text-muted-foreground uppercase"
  >
    {m.tariff_payback()}
  </h2>
  {#await payback}
    <LoadingRows />
  {:then answer}
    {#if "problem" in answer}
      <p role="alert" class="p-4 text-sm text-destructive">{problemText(answer.problem)}</p>
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
</section>
