<!--
	Local (not from the registry, #750): a surface that is pressed: a row, a tile, a figure. It is
	the one native <button> for what does not look like a Button: the caller lays it out and gives it
	its hover; the type, the keyboard focus ring and the disabled state come from here (ADR 21).
-->
<script lang="ts">
  import { cn, type WithElementRef } from "../utils.ts";
  import { haptics } from "../haptics.ts";
  import type { HTMLButtonAttributes } from "svelte/elements";
  import { FEEDBACK, SELECTED } from "./tint.ts";

  let {
    ref = $bindable(null),
    class: className,
    type = "button",
    feedback = false,
    selected = false,
    onclick,
    children,
    ...restProps
  }: WithElementRef<HTMLButtonAttributes> & {
    /** The app's tint under the pointer, the keyboard and a press, for a surface with none of its own. */
    feedback?: boolean;
    /** The app's tint of a chosen row: open, current or picked. */
    selected?: boolean;
  } = $props();

  // Local: a surface that holds a state ticks when a press changes it (ADR 21 "One behaviour, one
  // component"): a toggle (`aria-pressed`) on every press, a pick (`aria-selected`) when it is not
  // picked yet. After the caller, as the kit's switch.
  function press(event: Parameters<NonNullable<typeof onclick>>[0]): void {
    const pressed = restProps["aria-pressed"];
    const picked = restProps["aria-selected"];
    const changes =
      (pressed !== undefined && pressed !== null) || picked === false || picked === "false";

    onclick?.(event);

    if (changes) haptics.selection();
  }
</script>

<button
  bind:this={ref}
  data-slot="pressable"
  class={cn(
    "outline-none transition-[color,background-color,border-color,box-shadow] focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset disabled:pointer-events-none disabled:opacity-50",
    feedback && FEEDBACK,
    selected && SELECTED,
    className,
  )}
  {type}
  {...restProps}
  onclick={press}
>
  {@render children?.()}
</button>
