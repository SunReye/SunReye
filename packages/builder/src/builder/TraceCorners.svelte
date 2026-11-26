<!-- A traced roof's points on the canvas, faint where the house hides them, and the ring of the
  point or line the pointer snaps to. -->
<svelte:options namespace="svg" />

<script lang="ts">
  type On = readonly [number, number];

  interface Props {
    corners: readonly { readonly on: On; readonly hidden: boolean }[];
    ring: On | null;
  }

  let { corners, ring }: Props = $props();
</script>

{#each corners as { on: [x, y], hidden }, i (i)}
  <circle
    cx={x}
    cy={y}
    r="3.5"
    fill="var(--background)"
    stroke={hidden ? "var(--muted-foreground)" : "var(--brand)"}
    stroke-width="2"
    opacity={hidden ? 0.5 : 1}
    data-hidden={hidden || undefined}
  />
{/each}
{#if ring}
  <circle cx={ring[0]} cy={ring[1]} r="8" fill="none" stroke="var(--brand)" stroke-width="2" />
{/if}
