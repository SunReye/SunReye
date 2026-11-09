<script lang="ts">
  import type { Core } from "../api/core.ts";
  import LocaleSwitch from "../LocaleSwitch.svelte";
  import { m } from "../paraglide/messages.js";
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
      <a href="#/history">{m.nav_history()}</a>
      <a href="#/forecast">{m.nav_forecast()}</a>
      <a href="#/builder">{m.nav_builder()}</a>
      <a href="#/settings">{m.nav_settings()}</a>
      <a href="#/status">{m.nav_status()}</a>
      <LocaleSwitch bind:locale />
    {/snippet}
  </Dashboard>
{/key}
