<script lang="ts">
  import Section from "../components/section.svelte";
  import ProblemAlert from "../components/problem-alert.svelte";
  import type { Core } from "../api/core";
  import { m } from "../paraglide/messages.js";
  import LoadingRows from "../components/loading-rows.svelte";
  import TariffForm from "./TariffForm.svelte";

  let { core }: { core: Core } = $props();

  const tariff = $derived(core.tariff());
</script>

<Section title={m.tariff_title()}>
  {#await tariff}
    <LoadingRows />
  {:then answer}
    {#if !("problem" in answer)}
      <TariffForm {core} tariff={answer} />
    {:else if answer.problem === "tariff.none"}
      <!-- No tariff yet: the admin enters the first. -->
      <TariffForm {core} tariff={undefined} />
    {:else}
      <ProblemAlert problem={answer.problem} />
    {/if}
  {/await}
</Section>
