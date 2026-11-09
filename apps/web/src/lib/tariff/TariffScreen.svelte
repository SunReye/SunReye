<script lang="ts">
  import type { Core } from "../api/core";
  import Costs from "./Costs.svelte";
  import Payback from "./Payback.svelte";
  import PricesNow from "./PricesNow.svelte";
  import SpotZone from "./SpotZone.svelte";
  import TariffPanel from "./TariffPanel.svelte";

  let { core }: { core: Core } = $props();
</script>

<main>
  <PricesNow {core} />
  <Costs {core} />
  <Payback {core} />
  <TariffPanel {core} />
  <SpotZone {core} />
</main>
