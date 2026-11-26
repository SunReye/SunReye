<!-- The spot prices' licence conditions: the source, the licence and the change made (CC BY 4.0). -->
<script lang="ts">
  import { m } from "./paraglide/messages.js";

  let { class: className = "" }: { class?: string } = $props();
</script>

<p class={className}>
  {m.spot_source()}
  <a href="https://www.smard.de">Bundesnetzagentur | SMARD.de</a>,
  <a href="https://creativecommons.org/licenses/by/4.0/">CC BY 4.0</a>,
  {m.spot_via()}
  <a href="https://energy-charts.info">energy-charts.info</a>; {m.spot_converted()}
</p>
