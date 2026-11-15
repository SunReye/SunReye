<!--
  A titled part of a screen: a region named by its h2, with actions beside the title. Plain, it
  stacks under its title; as a `card` it is one glass surface whose header is ruled off; under an
  `eyebrow` it is a group of rows, as Settings lists them: a card of their own on a drill-in's
  phone level.
-->
<script lang="ts">
  import type { Snippet } from "svelte";
  import Eyebrow from "./eyebrow.svelte";
  import GlassCard from "./glass-card.svelte";

  let {
    title,
    card = false,
    eyebrow = false,
    actions,
    children,
  }: {
    title: string;
    card?: boolean;
    eyebrow?: boolean;
    actions?: Snippet;
    children: Snippet;
  } = $props();

  const id = $props.id();
</script>

{#snippet heading()}
  <h2 {id} class="min-w-0 flex-1 text-[15px] font-semibold">{title}</h2>
  {@render actions?.()}
{/snippet}

{#if card}
  <GlassCard element="section" aria-labelledby={id}>
    <header class="flex min-h-12 items-center gap-3 border-b border-border/60 px-4 py-2">
      {@render heading()}
    </header>
    {@render children()}
  </GlassCard>
{:else if eyebrow}
  <section aria-labelledby={id} class="flex flex-col">
    <Eyebrow element="h2" {id} class="px-4 pt-5 pb-2">{title}</Eyebrow>
    <div class="drill-card">{@render children()}</div>
  </section>
{:else}
  <section aria-labelledby={id} class="flex flex-col gap-3">
    <header class="flex items-center gap-3">{@render heading()}</header>
    {@render children()}
  </section>
{/if}
