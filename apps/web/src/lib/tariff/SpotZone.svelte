<script lang="ts">
  import Section from "../components/section.svelte";
  import type { Core } from "../api/core";
  import { m } from "../paraglide/messages.js";
  import LoadingRows from "../components/loading-rows.svelte";
  import ZoneSelect from "./ZoneSelect.svelte";

  let { core }: { core: Core } = $props();

  const zone = $derived(core.spotZone());
</script>

<Section title={m.spot_title()}>
  {#await zone}
    <LoadingRows rows={1} />
  {:then answer}
    <ZoneSelect {core} {answer} />
  {/await}
</Section>
