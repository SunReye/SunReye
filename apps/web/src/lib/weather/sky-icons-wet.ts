// The icons of what the weather code says falls or hangs (ADR 23 "Dashboard").
import CloudDrizzle from "@lucide/svelte/icons/cloud-drizzle";
import CloudFog from "@lucide/svelte/icons/cloud-fog";
import CloudLightning from "@lucide/svelte/icons/cloud-lightning";
import CloudRain from "@lucide/svelte/icons/cloud-rain";
import CloudRainWind from "@lucide/svelte/icons/cloud-rain-wind";
import CloudSnow from "@lucide/svelte/icons/cloud-snow";

export const WET = {
  fog: CloudFog,
  drizzle: CloudDrizzle,
  rain: CloudRain,
  snow: CloudSnow,
  showers: CloudRainWind,
  thunder: CloudLightning,
};
