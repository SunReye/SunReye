<script lang="ts">
  import { untrack } from "svelte";
  import { cubicOut } from "svelte/easing";
  import { prefersReducedMotion, Tween } from "svelte/motion";
  import { motion } from "./motion/tier.svelte";

  // Live ticks glide for slightly longer than the 2 s tick (ADR 21). `null` is "no reading yet":
  // a dash of the same width, so nothing shifts when the first sample lands.
  // `format` writes the rolling value itself (a unit, a sign); `appear` false starts at the value
  // instead of counting up from zero, for a figure that arrives with content already in motion.
  let {
    value,
    digits = 1,
    duration = 2200,
    format,
    placeholder,
    appear = true,
  }: { value: number | null; digits?: number; duration?: number; format?: (v: number) => string; placeholder?: string; appear?: boolean } = $props();

  const tween = new Tween(untrack(() => (appear ? 0 : (value ?? 0))), { duration: 900, easing: cubicOut });
  let first = untrack(() => appear || value === null);

  $effect(() => {
    if (value === null) return;
    const still = prefersReducedMotion.current || motion.still;
    tween.set(value, { duration: still ? 0 : first ? 900 : duration });
    first = false;
  });

  const nf = $derived(new Intl.NumberFormat("de-DE", { minimumFractionDigits: digits, maximumFractionDigits: digits }));
</script>

<span class="tabular-nums">{value === null ? (placeholder ?? (digits > 0 ? `–,${"–".repeat(digits)}` : "––")) : format ? format(tween.current) : nf.format(tween.current)}</span>
