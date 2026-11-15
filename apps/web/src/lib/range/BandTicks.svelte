<!-- The chart's gridlines, or their figures on the axis: each keeps its value and travels to its new place. -->
<script lang="ts">
  import type { Tick } from "./bands.ts";
  import type { Kept } from "./presence.svelte.ts";

  let { list, axis = false }: { list: readonly Kept<Tick>[]; axis?: boolean } = $props();
</script>

{#each list as t (t.key)}
  <span
    class={["tick", t.out && "out", t.fresh >= 0 && "fresh"]}
    style:transform="translateY({t.item.y.toFixed(3)}%)"
    style:--y0="{t.item.y0.toFixed(3)}%"
  >
    {#if axis}
      <span class="absolute top-0 right-0 -translate-y-1/2 leading-none">{t.item.text}</span>
    {:else}
      <span
        class={[
          "absolute inset-x-0 top-0 h-px",
          t.item.v === 0 ? "bg-foreground/30" : "bg-foreground/[0.07]",
        ]}
      ></span>
    {/if}
  </span>
{/each}

<style>
  .tick {
    position: absolute;
    inset: 0;
    pointer-events: none;
    transition:
      transform var(--move),
      opacity 200ms var(--motion-ease);
  }
  .tick.out {
    opacity: 0;
  }
  @starting-style {
    .tick.fresh {
      transform: translateY(var(--y0));
      opacity: 0;
    }
  }
  :global(.still) .tick {
    transition: none;
  }
</style>
