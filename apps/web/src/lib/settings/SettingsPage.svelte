<!-- One settings group's page, by its id. -->
<script lang="ts">
  import type { Core } from "../api/core";
  import ConnectionsSettings from "./ConnectionsSettings.svelte";
  import DangerSettings from "./DangerSettings.svelte";
  import DevicesSettings from "./DevicesSettings.svelte";
  import DisplaySettings from "./DisplaySettings.svelte";
  import ForecastSettings from "./ForecastSettings.svelte";
  import LogsSettings from "./LogsSettings.svelte";
  import PlantSettings from "./PlantSettings.svelte";
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
    ["logs", logs],
    ["danger", danger],
  ]);
</script>

{#snippet plant()}<PlantSettings {core} />{/snippet}
{#snippet devices()}<DevicesSettings {core} />{/snippet}
{#snippet writes()}<WritesSettings {core} />{/snippet}
{#snippet connections()}<ConnectionsSettings {core} />{/snippet}
{#snippet tariff()}<TariffSettings {core} />{/snippet}
{#snippet forecast()}<ForecastSettings />{/snippet}
{#snippet display()}<DisplaySettings />{/snippet}
{#snippet logs()}<LogsSettings {core} />{/snippet}
{#snippet danger()}<DangerSettings {core} />{/snippet}

{@render pages.get(id)?.()}
