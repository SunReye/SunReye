<script lang="ts">
  import { Button } from "#lib/components/ui/button/index.js";
  import { Input } from "#lib/components/ui/input/index.js";
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

<form class="flex flex-wrap items-end gap-2" onsubmit={invest}>
  <label class="flex flex-col gap-1.5 text-sm" for="{id}-amount">
    {m.tariff_investment_field()}
    <Input
      id="{id}-amount"
      type="number"
      min="0.01"
      step="0.01"
      required
      class="w-40"
      bind:value={amount}
    />
  </label>
  <Button type="submit">{m.tariff_save()}</Button>
</form>
{#if refused}
  <p role="alert">{problemText(refused.problem)}</p>
{/if}
