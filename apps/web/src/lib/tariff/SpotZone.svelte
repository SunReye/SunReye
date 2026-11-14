<script lang="ts">
  import type { Core } from "../api/core";
  import { m } from "../paraglide/messages.js";
  import LoadingRows from "../components/loading-rows.svelte";
  import ZoneSelect from "./ZoneSelect.svelte";

  let { core }: { core: Core } = $props();

  const id = $props.id();

  const zone = $derived(core.spotZone());
</script>

<section aria-labelledby="{id}-title" class="flex flex-col">
  <h2
    id="{id}-title"
    class="px-4 pt-5 pb-2 text-xs font-medium tracking-wide text-muted-foreground uppercase"
  >
    {m.spot_title()}
  </h2>
  {#await zone}
    <LoadingRows rows={1} />
  {:then answer}
    <ZoneSelect {core} {answer} />
  {/await}
</section>
