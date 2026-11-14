<!-- Settings › Tariff: the tariff, the spot-price zone and the investment payback counts against (ADR 12). -->
<script lang="ts">
  import type { Core } from "../api/core";
  import Payback from "../tariff/Payback.svelte";
  import SpotZone from "../tariff/SpotZone.svelte";
  import TariffPanel from "../tariff/TariffPanel.svelte";

  let { core }: { core: Core } = $props();
</script>

<div class="flex flex-col pb-4">
  <TariffPanel {core} />
  <SpotZone {core} />
  <Payback {core} />
</div>
