<script lang="ts">
  import SunMedium from "@lucide/svelte/icons/sun-medium";
  import Wind from "@lucide/svelte/icons/wind";
  import Sunset from "@lucide/svelte/icons/sunset";
  import * as Card from "#lib/components/ui/card/index.js";
  import type { LiveSim } from "./sim.svelte";
  let { sim, onopen }: { sim: LiveSim; onopen: (id: string) => void } = $props();
</script>

<Card.Root
  size="sm"
  interactive
  role="button"
  tabindex={0}
  onclick={() => onopen("weather")}
  onkeydown={(e: KeyboardEvent) => e.key === "Enter" && onopen("weather")}
  class="glass-ambient flex-row items-center gap-3 px-4 py-2"
>
  <span class="grid size-9 place-items-center rounded-md bg-solar/15 text-solar"><SunMedium class="size-5" /></span>
  <span class="flex flex-col">
    <span class="text-base leading-tight font-semibold tabular-nums">{sim.weather.temp} °C <span class="font-medium text-muted-foreground">· {sim.weather.label}</span></span>
    <span class="text-xs text-muted-foreground">Bewölkung {sim.weather.cloud} %</span>
  </span>
  <span class="ml-auto flex items-center gap-4 text-xs text-muted-foreground tabular-nums">
    <span class="flex items-center gap-1"><Wind class="size-3.5" />{sim.weather.wind} km/h</span>
    <span class="flex items-center gap-1"><Sunset class="size-3.5" />21:04</span>
  </span>
</Card.Root>
