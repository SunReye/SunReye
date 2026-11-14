<script lang="ts">
  import type { Core } from "../api/core";
  import ProblemAlert from "../components/problem-alert.svelte";
  import { m } from "../paraglide/messages.js";
  import LoadingRows from "../components/loading-rows.svelte";
  import TariffForm from "./TariffForm.svelte";

  let { core }: { core: Core } = $props();

  const id = $props.id();

  const tariff = $derived(core.tariff());
</script>

<!-- The page is titled Tarif already: the heading names the region for assistive tech only. -->
<section aria-labelledby="{id}-title" class="flex flex-col">
  <h2 id="{id}-title" class="sr-only">{m.tariff_title()}</h2>
  {#await tariff}
    <LoadingRows />
  {:then answer}
    {#if !("problem" in answer)}
      <TariffForm {core} tariff={answer} />
    {:else if answer.problem === "tariff.none"}
      <!-- No tariff yet: the admin enters the first. -->
      <TariffForm {core} tariff={undefined} />
    {:else}
      <div class="p-4"><ProblemAlert problem={answer.problem} /></div>
    {/if}
  {/await}
</section>
