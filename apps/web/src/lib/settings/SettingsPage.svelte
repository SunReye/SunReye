<!-- One settings group's page, by its id. -->
<script lang="ts">
  import type { Core } from "../api/core";
  import AboutSettings from "./AboutSettings.svelte";
  import ConnectionsSettings from "./ConnectionsSettings.svelte";
  import DevicesSettings from "./DevicesSettings.svelte";
  import DisplaySettings from "./DisplaySettings.svelte";
  import ForecastSettings from "./ForecastSettings.svelte";
  import PlantSettings from "./PlantSettings.svelte";
  import SystemSettings from "./SystemSettings.svelte";
  import TariffSettings from "./TariffSettings.svelte";
  import WritesSettings from "./WritesSettings.svelte";

  let { core, id }: { core: Core; id: string } = $props();

  const pages = new Map([
    ["plant", plant],
    ["devices", devices],
    ["writes", writes],
    ["connections", connections],
    ["tariff", tariff],
    ["forecast", forecast],
    ["display", display],
    ["about", about],
  ]);
</script>

{#snippet plant()}<PlantSettings {core} />{/snippet}
{#snippet devices()}<DevicesSettings {core} />{/snippet}
{#snippet writes()}<WritesSettings {core} />{/snippet}
{#snippet connections()}<ConnectionsSettings {core} />{/snippet}
{#snippet tariff()}<TariffSettings {core} />{/snippet}
{#snippet forecast()}<ForecastSettings />{/snippet}
{#snippet display()}<DisplaySettings />{/snippet}
{#snippet about()}<AboutSettings />{/snippet}

{#if pages.has(id)}
  {@render pages.get(id)?.()}
{:else}
  <SystemSettings {core} {id} />
{/if}
