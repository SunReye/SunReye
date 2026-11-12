<!-- Settings › Tariff: the tariff and the spot-price zone (ADR 12). -->
<script lang="ts">
  import type { Core } from "../api/core";
  import SpotZone from "../tariff/SpotZone.svelte";
  import TariffPanel from "../tariff/TariffPanel.svelte";

  let { core }: { core: Core } = $props();
</script>

<div class="flex flex-col gap-6 p-4">
  <TariffPanel {core} />
  <SpotZone {core} />
</div>
