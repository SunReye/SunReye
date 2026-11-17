<!-- One quantity's row of the weather detail: its name, what else is drawn over it, the day's
  figure, then its marks. While an hour is read its values stand in the figure's place (ADR 21
  "Chart reading"). -->
<script lang="ts" module>
  /** A second reading drawn in a row, named beside the row's own. */
  export interface Also {
    readonly label: string;
    readonly colour: string;
    readonly dashed?: boolean;
  }
</script>

<script lang="ts">
  import type { Snippet } from "svelte";

  let {
    label,
    also,
    figure,
    read,
    tail,
    children,
  }: {
    label: string;
    also?: Also | null;
    /** The day's range or sum; null without a value. */
    figure: string | null;
    /** The row's value at the hour being read, then its second reading's; undefined while none is. */
    read?: readonly string[] | undefined;
    /** After the read values, as the wind's direction. */
    tail?: Snippet;
    children: Snippet;
  } = $props();
</script>

{#snippet swatch(of: Also, width: string)}
  <span
    class={[width, "shrink-0 border-t-2", of.dashed && "border-dashed"]}
    style:border-color={of.colour}
  ></span>
{/snippet}

<div class="flex flex-col gap-1">
  <div class="flex items-baseline justify-between gap-3 text-xs">
    <span class="flex min-w-0 items-center gap-2">
      <span class="shrink-0 font-medium">{label}</span>
      {#if also}
        <span class="flex min-w-0 items-center gap-1 text-muted-foreground">
          {@render swatch(also, "w-5")}
          <span class="truncate">{also.label}</span>
        </span>
      {/if}
    </span>
    {#if read}
      <span class="flex shrink-0 items-center gap-1.5 tabular-nums" data-figure>
        <span class="font-medium">{read[0]}</span>
        {#if also && read[1] !== undefined}
          {@render swatch(also, "w-3")}
          <span class="text-muted-foreground">{read[1]}</span>
        {/if}
        {@render tail?.()}
      </span>
    {:else if figure}
      <span class="shrink-0 text-muted-foreground tabular-nums">{figure}</span>
    {/if}
  </div>
  {@render children()}
</div>
