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
    /** The row's value at the hour being read, then its second reading's; null while none is. */
    read?: readonly string[] | null | undefined;
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
  <div class="flex flex-col gap-0.5 text-xs">
    <div class="flex items-baseline justify-between gap-3" data-row-line>
      <span class="min-w-0 truncate font-medium">{label}</span>
      {#if read}
        <span class="flex shrink-0 items-center gap-1.5 tabular-nums" data-figure>
          <span class="font-medium">{read[0]}</span>
          {@render tail?.()}
        </span>
      {:else if figure}
        <span class="shrink-0 text-muted-foreground tabular-nums">{figure}</span>
      {/if}
    </div>
    {#if also}
      <!-- The second reading on a line of its own, so neither crowds the other's name. -->
      <div class="flex items-baseline justify-between gap-3 text-muted-foreground" data-row-line>
        <span class="flex min-w-0 items-center gap-1.5">
          {@render swatch(also, "w-5")}
          <span class="truncate">{also.label}</span>
        </span>
        {#if read && read[1] !== undefined}
          <span class="shrink-0 tabular-nums">{read[1]}</span>
        {/if}
      </div>
    {/if}
  </div>
  {@render children()}
</div>
