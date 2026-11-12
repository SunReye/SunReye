<script lang="ts">
  import { cubicOut } from "svelte/easing";
  import { prefersReducedMotion, Tween } from "svelte/motion";
  import { motion } from "../motion/tier.svelte.ts";
  import { getLocale } from "../paraglide/runtime.js";

  // Live ticks glide for slightly longer than the 2 s tick (ADR 21). `null` is "no reading yet":
  // a dash of the same width, so nothing shifts when the first sample lands.
  let {
    value,
    digits = 1,
    duration = 2200,
  }: { value: number | null; digits?: number; duration?: number } = $props();

  const tween = new Tween(0, { duration: 900, easing: cubicOut });
  let first = true;

  $effect(() => {
    if (value === null) return;
    const still = prefersReducedMotion.current || motion.still;
    void tween.set(value, { duration: still ? 0 : first ? 900 : duration });
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

<span class="tabular-nums">{value === null ? dash : format.format(tween.current)}</span>
