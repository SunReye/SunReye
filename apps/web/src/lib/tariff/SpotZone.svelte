<script lang="ts">
  import type { Core } from "../api/core";
  import { m } from "../paraglide/messages.js";
  import ZoneSelect from "./ZoneSelect.svelte";

  let { core }: { core: Core } = $props();

  const id = $props.id();

  const zone = $derived(core.spotZone());
</script>

<section aria-labelledby="{id}-title">
  <h2 id="{id}-title">{m.spot_title()}</h2>
  {#await zone then answer}
    <ZoneSelect {core} {answer} />
  {/await}
</section>
