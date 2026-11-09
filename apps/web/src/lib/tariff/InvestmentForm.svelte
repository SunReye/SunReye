<script lang="ts">
  import type { Core, Problem } from "../api/core";
  import { problemText } from "../i18n/problems";
  import { m } from "../paraglide/messages.js";

  let { core, oninvested }: { core: Core; oninvested: () => void } = $props();

  const id = $props.id();

  let amount = $state<number | null>(null);
  let refused = $state.raw<Problem>();

  async function invest(event: SubmitEvent): Promise<void> {
    event.preventDefault();

    if (amount === null) return;

    refused = await core.invest(amount);
    oninvested();
  }
</script>

<form onsubmit={invest}>
  <label for="{id}-amount">{m.tariff_investment_field()}</label>
  <input id="{id}-amount" type="number" min="0.01" step="0.01" required bind:value={amount} />
  <button type="submit">{m.tariff_save()}</button>
</form>
{#if refused}
  <p role="alert">{problemText(refused.problem)}</p>
{/if}
