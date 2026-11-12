<script lang="ts">
  import type { Core } from "../api/core.ts";
  import LocaleSwitch from "../LocaleSwitch.svelte";
  import { getLocale } from "../paraglide/runtime.js";
  import Dashboard from "./Dashboard.svelte";
  import type { SceneLayout } from "./dashboard.ts";

  let { core, layout }: { core: Core; layout: SceneLayout | null } = $props();

  let locale = $state(getLocale());
</script>

<!-- Messages are no state: a new locale renders the screen anew. -->
{#key locale}
  <Dashboard {core} {layout}>
    {#snippet nav()}
      <LocaleSwitch bind:locale />
    {/snippet}
  </Dashboard>
{/key}
