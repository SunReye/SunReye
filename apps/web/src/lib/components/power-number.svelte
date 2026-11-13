<!-- A rolling power in the SPA's one power format (lib/power.ts): the unit follows the glide. -->
<script lang="ts">
  import type { ClassValue } from "svelte/elements";
  import { powerNumber, powerUnit } from "../power.ts";
  import AnimatedNumber from "./animated-number.svelte";

  let {
    watts,
    unitClass,
    suffix = "",
  }: { watts: number | null; unitClass?: ClassValue | undefined; suffix?: string } = $props();
</script>

<AnimatedNumber value={watts} format={powerNumber} placeholder="–"
  >{#snippet unit(v: number)}{" "}<span class={unitClass}>{powerUnit(v)}{suffix}</span
    >{/snippet}</AnimatedNumber
>
