<!-- Settings › Plant: the plant timezone and location, as set up on the first run. -->
<script lang="ts">
  import type { Core } from "../api/core";
  import LoadingRows from "../components/loading-rows.svelte";
  import { m } from "../paraglide/messages.js";
  import PlantStep from "../setup/PlantStep.svelte";

  let { core }: { core: Core } = $props();

  async function load() {
    const [zone, location] = await Promise.all([core.timezone(), core.location()]);

    return {
      zone: "problem" in zone ? Intl.DateTimeFormat().resolvedOptions().timeZone : zone.name,
      location: "problem" in location ? undefined : location,
    };
  }

  const current = $derived.by(() => load());

  let saved = $state(false);
</script>

<div class="flex flex-col">
  {#await current}
    <LoadingRows rows={3} />
  {:then plant}
    <PlantStep
      {core}
      current={plant}
      action={m.settings_save()}
      ondone={() => {
        saved = true;
      }}
    />
  {/await}
  {#if saved}<p role="status" class="px-4 pb-4 text-sm text-muted-foreground">
      {m.settings_saved()}
    </p>{/if}
</div>
