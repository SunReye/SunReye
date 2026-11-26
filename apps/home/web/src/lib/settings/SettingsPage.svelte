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

  let {
    core,
    id,
    level,
    onlevel,
  }: {
    core: Core;
    id: string;
    /** The level open inside the page, from the hash route; null on the page itself. */
    level: string | null;
    onlevel: (id: string | null) => void;
  } = $props();

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
{#snippet devices()}<DevicesSettings {core} {level} {onlevel} />{/snippet}
{#snippet writes()}<WritesSettings {core} />{/snippet}
{#snippet connections()}<ConnectionsSettings {core} {level} {onlevel} />{/snippet}
{#snippet tariff()}<TariffSettings {core} />{/snippet}
{#snippet forecast()}<ForecastSettings />{/snippet}
{#snippet display()}<DisplaySettings />{/snippet}
{#snippet about()}<AboutSettings />{/snippet}

{#if pages.has(id)}
  {@render pages.get(id)?.()}
{:else}
  <SystemSettings {core} {id} />
{/if}
