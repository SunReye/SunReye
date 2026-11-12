<script lang="ts">
  import { cubicOut } from "svelte/easing";
  import { prefersReducedMotion, Tween } from "svelte/motion";

  // Live ticks glide for slightly longer than the 2 s tick (ADR 21).
  let { value, digits = 1, duration = 2200 }: { value: number; digits?: number; duration?: number } =
    $props();

  const tween = new Tween(0, { duration: 900, easing: cubicOut });
  let first = true;

  $effect(() => {
    tween.set(value, { duration: prefersReducedMotion.current ? 0 : first ? 900 : duration });
    first = false;
  });

  const nf = $derived(
    new Intl.NumberFormat("de-DE", { minimumFractionDigits: digits, maximumFractionDigits: digits }),
  );
</script>

<span class="tabular-nums">{nf.format(tween.current)}</span>
