<!--
  A screen's title: its one h1. Wide chart screens, whose header shares a row with the range
  control, take the smaller size; sign-in and setup put the brand's sun mark before it.
-->
<script lang="ts">
  import SunMark from "./sun-mark.svelte";

  let {
    title,
    wide = false,
    brand = false,
    class: className,
  }: { title: string; wide?: boolean; brand?: boolean; class?: string } = $props();
</script>

{#snippet heading(extra: string | undefined)}
  <h1 class={["font-semibold tracking-tight", wide ? "text-xl lg:leading-8" : "text-2xl", extra]}>
    {title}
  </h1>
{/snippet}

{#if brand}
  <div class={["flex items-center gap-3", className]}>
    <SunMark class="size-7 shrink-0" />
    {@render heading(undefined)}
  </div>
{:else}
  {@render heading(className)}
{/if}
