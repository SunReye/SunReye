<script lang="ts">
  import { untrack } from "svelte";
  import { cubicOut } from "svelte/easing";
  import { Tween } from "svelte/motion";
  import { tickGlideMs } from "../live/stream.svelte.ts";
  import { motion } from "../motion/tier.svelte.ts";
  import { getLocale } from "../paraglide/runtime.js";

  // Live ticks glide for slightly longer than the tick (ADR 21); a halted stream steps to its last
  // reading and holds there. `null` is "no reading yet": a dash over a hidden zero, so it takes the
  // number's width and nothing shifts when the first sample lands.
  // `format` writes the rolling value itself (a unit, a sign); `duration` sets a glide that is not
  // a live tick's; `appear` false starts at the value instead of counting up from zero, for a
  // figure that arrives with content already in motion.
  let {
    value,
    digits = 1,
    format,
    placeholder,
    duration,
    appear = true,
  }: {
    value: number | null;
    digits?: number;
    format?: (v: number) => string;
    placeholder?: string;
    duration?: number;
    appear?: boolean;
  } = $props();

  const tween = new Tween(
    untrack(() => (appear ? 0 : (value ?? 0))),
    { duration: 900, easing: cubicOut },
  );

  let first = untrack(() => appear || value === null);

  $effect(() => {
    if (value === null) return;
    const glide = duration === undefined ? tickGlideMs() : motion.still ? 0 : duration;

    void tween.set(value, { duration: glide > 0 && first ? 900 : glide });
    first = false;
  });

  /** The SPA's locale, not the browser's; a new locale renders the screen anew. */
  const nf = $derived(
    new Intl.NumberFormat(getLocale(), {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }),
  );

  const write = $derived(format ?? ((v: number) => nf.format(v)));

  const dash = $derived(placeholder ?? (digits > 0 ? `–,${"–".repeat(digits)}` : "––"));
</script>

<span class="inline-grid tabular-nums"
  ><span class={["[grid-area:1/1]", value === null && "invisible"]}
    >{write(value === null ? 0 : tween.current)}</span
  >{#if value === null}<span class="[grid-area:1/1] text-center">{dash}</span>{/if}</span
>
