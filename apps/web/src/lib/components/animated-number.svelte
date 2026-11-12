<script lang="ts">
  import { cubicOut } from "svelte/easing";
  import { Tween } from "svelte/motion";
  import { glideDurationMs, TICK_MS } from "../live/glide.ts";
  import { stream } from "../live/stream.svelte.ts";
  import { motion } from "../motion/tier.svelte.ts";
  import { getLocale } from "../paraglide/runtime.js";

  // Live ticks glide for slightly longer than the tick (ADR 21); a halted stream steps to its last
  // reading and holds there. `null` is "no reading yet": a dash over a hidden zero, so it takes the
  // number's width and nothing shifts when the first sample lands.
  let { value, digits = 1 }: { value: number | null; digits?: number } = $props();

  const tween = new Tween(0, { duration: 900, easing: cubicOut });
  let first = true;

  $effect(() => {
    if (value === null) return;
    const still = motion.still || stream.halted;
    void tween.set(value, { duration: still ? 0 : first ? 900 : glideDurationMs(TICK_MS, false) });
    first = false;
  });

  /** The SPA's locale, not the browser's; a new locale renders the screen anew. */
  const format = $derived(
    new Intl.NumberFormat(getLocale(), {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }),
  );

  const dash = $derived(digits > 0 ? `–,${"–".repeat(digits)}` : "––");
</script>

<span class="inline-grid tabular-nums"
  ><span class={["[grid-area:1/1]", value === null && "invisible"]}
    >{format.format(value === null ? 0 : tween.current)}</span
  >{#if value === null}<span class="[grid-area:1/1] text-center">{dash}</span>{/if}</span
>
