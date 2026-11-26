<!-- A traced roof's values beside the pointer: each dragged line's length, each face's pitch as
  the drag leaves it, and the chip of the line being drawn. -->
<script lang="ts">
  type At = { readonly key: string; readonly x: number; readonly y: number };

  interface Props {
    lengths: readonly (At & { readonly length: number })[];
    pitches: readonly (At & { readonly pitch: number })[];
    chip: { readonly text: string; readonly at: readonly [number, number] } | null;
    format: { readonly metres: Intl.NumberFormat; readonly degrees: Intl.NumberFormat };
  }

  let { lengths, pitches, chip, format }: Props = $props();
</script>

{#each lengths as { key, x, y, length } (key)}
  <output
    data-dragged-length
    class="canvas-chip pointer-events-none absolute flex h-6 -translate-x-1/2 -translate-y-1/2 items-center rounded-md px-1.5 text-[11px] whitespace-nowrap tabular-nums ring-1 ring-border/60 elevation-1"
    style:left="{x}px"
    style:top="{y}px">{format.metres.format(length)} m</output
  >
{/each}
{#each pitches as { key, x, y, pitch } (key)}
  <output
    data-dragged-pitch
    class="canvas-chip pointer-events-none absolute flex h-6 -translate-x-1/2 -translate-y-1/2 items-center rounded-md px-1.5 text-[11px] font-medium whitespace-nowrap tabular-nums ring-1 ring-border/60 elevation-1"
    style:left="{x}px"
    style:top="{y}px">{format.degrees.format(pitch)}°</output
  >
{/each}
{#if chip}
  <!-- The same canvas chip as a handle's live value; it never takes the pointer. -->
  <output
    class="canvas-chip pointer-events-none absolute flex h-7 translate-x-3.5 -translate-y-full items-center rounded-md px-2 text-xs whitespace-nowrap tabular-nums ring-1 ring-border/60 elevation-1"
    style:left="{chip.at[0]}px"
    style:top="{chip.at[1] - 8}px">{chip.text}</output
  >
{/if}
