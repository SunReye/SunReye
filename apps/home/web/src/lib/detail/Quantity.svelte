<!-- A rolling number with its unit; a power in the shared power format (lib/power.ts). -->
<script lang="ts">
  import type { ClassValue } from "svelte/elements";
  import AnimatedNumber from "../components/animated-number.svelte";
  import PowerNumber from "../components/power-number.svelte";
  import { isPower } from "../power.ts";

  let {
    value,
    unit,
    digits = 1,
    unitClass,
  }: { value: number | null; unit: string; digits?: number; unitClass?: ClassValue } = $props();
</script>

{#if isPower(unit)}<PowerNumber watts={value} {unitClass} />{:else}<AnimatedNumber
    {value}
    {digits}
  />{#if unit}{" "}<span class={unitClass}>{unit}</span>{/if}{/if}
