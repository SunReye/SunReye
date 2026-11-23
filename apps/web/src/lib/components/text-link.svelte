<!--
  A link inside text, or standing alone under it (ADR 21): the brand's colour, underlined under the
  pointer, the app's one focus ring. With `href` it goes to a screen; with `onclick` it acts, a
  button that reads the same. `onward` ends it on an arrow that leans on under the pointer.
-->
<script lang="ts">
  import ArrowRight from "@lucide/svelte/icons/arrow-right";
  import type { Snippet } from "svelte";
  import { Pressable } from "@sunreye/ui/pressable";

  let {
    href,
    onclick,
    onward = false,
    class: className,
    children,
  }: ({ href: string; onclick?: undefined } | { onclick: () => void; href?: undefined }) & {
    onward?: boolean;
    class?: string;
    children: Snippet;
  } = $props();

  // Pressable's own ring, so both forms share it.
  const look = $derived([
    "rounded-sm font-medium text-brand underline-offset-2 outline-none hover:underline focus-visible:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
    onward && "group inline-flex items-center gap-2",
  ]);
</script>

{#snippet body()}
  {@render children()}
  {#if onward}<ArrowRight class="size-4 transition-transform group-hover:translate-x-0.5" />{/if}
{/snippet}

{#if href === undefined}
  <Pressable class={[look, className]} {onclick}>{@render body()}</Pressable>
{:else}
  <a {href} class={[look, className]}>{@render body()}</a>
{/if}
