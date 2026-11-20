<!-- One band's axis label, or the running band's live dot, travelling with its bar. -->
<script lang="ts">
  import type { View } from "./bands.ts";
  import type { Kept } from "./presence.svelte.ts";

  let {
    k,
    strong,
  }: {
    k: Kept<View>;
    /** The band being read, or the running one. */
    strong: boolean;
  } = $props();

  const o = $derived(k.item);
  const live = $derived(o.b.state === "live" && !o.b.tick);
</script>

{#if live || o.b.tick}
  <span
    class={["label", k.out && "out", k.fresh >= 0 && "fresh"]}
    style:transform="translateX({o.cx.toFixed(2)}px)"
    style:--x0="{o.cx0.toFixed(2)}px"
  >
    {#if live}
      <!-- The running band: it grows with the live stream. In the lane above the labels, clear of its neighbour's. -->
      <span
        data-now
        class="absolute top-0 left-0 size-1.5 -translate-x-1/2 rounded-full bg-success text-success animate-pulse-dot motion-reduce:animate-none"
      ></span>
    {:else}
      <span
        class={[
          "absolute bottom-0 left-0 -translate-x-1/2 whitespace-nowrap",
          strong && "font-medium text-foreground",
        ]}>{o.b.label}</span
      >
    {/if}
  </span>
{/if}

<style>
  .label {
    position: absolute;
    inset: 0 auto 0 0;
    transition:
      transform var(--move),
      opacity var(--motion-base) var(--motion-ease);
  }
  .label.out {
    opacity: 0;
    transition:
      transform var(--move),
      opacity var(--motion-exit) var(--motion-ease-exit);
  }
  @starting-style {
    .label.fresh {
      transform: translateX(var(--x0));
      opacity: 0;
    }
  }
  :global(.still) .label {
    transition: none;
  }
</style>
