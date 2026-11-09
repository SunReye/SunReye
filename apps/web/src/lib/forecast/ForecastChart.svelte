<script lang="ts">
  import type { Core } from "../api/core.ts";
  import { getLocale } from "../paraglide/runtime.js";
  import PowerLines from "../PowerLines.svelte";
  import { forecastRows, type Line } from "./forecast.ts";

  let { core, device, lines }: { core: Core; device: number; lines: readonly Line[] } = $props();

  /** The SPA's locale, not the browser's; a new locale renders the screen anew. */
  const clock = new Intl.DateTimeFormat(getLocale(), {
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

  const rows = $derived(forecastRows(core, device, lines));
</script>

<figure>
  {#await rows then data}
    <PowerLines rows={data} height={280} time={clock} />
  {/await}
</figure>
