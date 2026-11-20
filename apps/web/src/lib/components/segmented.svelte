<!--
  The segmented control (ADR 21 "One behaviour, one component"): one of a few words, the hero's
  3D/2D look, its pressed box sliding to the next choice. It owns the look and the haptic.
-->
<script lang="ts" generics="T extends string">
  import * as ToggleGroup from "#lib/components/ui/toggle-group/index.js";
  import { haptics } from "../haptics.ts";

  let {
    options,
    value,
    onchange,
    label,
    labelledby,
    fill = false,
    canvas = false,
  }: {
    /** Each option's value and its text. */
    options: readonly (readonly [T, string])[];
    value: T;
    /** A choice the user made, other than the current one. */
    onchange: (next: T) => void;
    label?: string | undefined;
    labelledby?: string | undefined;
    /** Full width, one equal column per option. */
    fill?: boolean;
    /** Floats over the 3D canvas. */
    canvas?: boolean;
  } = $props();

  // A tap on the chosen option sends "" from the group; it and the current value change nothing.
  function set(next: string): void {
    const chosen = options.find(([option]) => option === next)?.[0];

    if (chosen === undefined || chosen === value) return;

    haptics.selection();
    onchange(chosen);
  }
</script>

<ToggleGroup.Root
  type="single"
  size="sm"
  spacing={1}
  bind:value={() => value, set}
  class={[
    "rounded-md p-0.5 ring-1 ring-border/60",
    // One equal column per option, without a class per count; the kit's own `style` keeps its gap.
    fill && "grid w-full auto-cols-fr grid-flow-col",
    canvas && "canvas-chip elevation-1",
  ]}
  aria-label={label}
  aria-labelledby={labelledby}
>
  {#each options as [option, text] (option)}
    <ToggleGroup.Item value={option} class={fill ? "min-w-0 px-2 text-xs" : "px-3 text-xs"}>
      {text}
    </ToggleGroup.Item>
  {/each}
</ToggleGroup.Root>
