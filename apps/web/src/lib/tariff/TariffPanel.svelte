<script lang="ts">
  import type { Core } from "../api/core";
  import { problemText } from "../i18n/problems";
  import { m } from "../paraglide/messages.js";
  import LoadingRows from "../components/loading-rows.svelte";
  import TariffForm from "./TariffForm.svelte";

  let { core }: { core: Core } = $props();

  const id = $props.id();

  const tariff = $derived(core.tariff());
</script>

<section aria-labelledby="{id}-title" class="flex flex-col gap-3">
  <h2 id="{id}-title" class="text-[15px] font-medium">{m.tariff_title()}</h2>
  {#await tariff}
    <LoadingRows />
  {:then answer}
    {#if !("problem" in answer)}
      <TariffForm {core} tariff={answer} />
    {:else if answer.problem === "tariff.none"}
      <!-- No tariff yet: the admin enters the first. -->
      <TariffForm {core} tariff={undefined} />
    {:else}
      <p role="alert">{problemText(answer.problem)}</p>
    {/if}
  {/await}
</section>
