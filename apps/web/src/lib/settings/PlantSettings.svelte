<!-- Settings › Plant: the plant timezone and location, as set up on the first run. -->
<script lang="ts">
  import { toast } from "svelte-sonner";
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
</script>

<div class="drill-card flex flex-col">
  {#await current}
    <LoadingRows rows={3} />
  {:then plant}
    <PlantStep
      {core}
      current={plant}
      action={m.settings_save()}
      ondone={() => {
        toast.success(m.settings_saved());
      }}
    />
  {/await}
</div>
