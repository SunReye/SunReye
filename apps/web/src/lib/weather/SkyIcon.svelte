<!-- The sky's icon (ADR 23 "Dashboard"): decoration beside its word, which says it. -->
<script lang="ts">
  import Cloud from "@lucide/svelte/icons/cloud";
  import CloudDrizzle from "@lucide/svelte/icons/cloud-drizzle";
  import CloudFog from "@lucide/svelte/icons/cloud-fog";
  import CloudLightning from "@lucide/svelte/icons/cloud-lightning";
  import CloudRain from "@lucide/svelte/icons/cloud-rain";
  import CloudRainWind from "@lucide/svelte/icons/cloud-rain-wind";
  import CloudSnow from "@lucide/svelte/icons/cloud-snow";
  import CloudSun from "@lucide/svelte/icons/cloud-sun";
  import Cloudy from "@lucide/svelte/icons/cloudy";
  import Moon from "@lucide/svelte/icons/moon";
  import Sun from "@lucide/svelte/icons/sun";
  import type { Sky } from "./sky.ts";

  let { sky, class: className = "size-4" }: { sky: Sky; class?: string } = $props();

  const ICONS = {
    sunny: Sun,
    fair: CloudSun,
    cloudy: Cloud,
    overcast: Cloudy,
    clear: Moon,
    fog: CloudFog,
    drizzle: CloudDrizzle,
    rain: CloudRain,
    snow: CloudSnow,
    showers: CloudRainWind,
    thunder: CloudLightning,
  };

  const Icon = $derived(ICONS[sky]);
</script>

<Icon class={className} aria-hidden="true" />
