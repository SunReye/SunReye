<!--
  One section of a drill-in page (ADR 21 "One card"): the kit's card while the page is a level of
  its own on a phone; beside the panes, where the page already stands on the pane's card, its rows
  alone. Clipped, not hidden, so a bar inside still sticks to the screen; a section that draws
  nothing takes no room.
-->
<script lang="ts" module>
  import { createContext } from "svelte";

  /** Whether a page stands as a level of its own: its sections are cards. */
  export const [levelCards, carded, inDrillIn] = createContext<() => boolean>();
</script>

<script lang="ts">
  import type { Snippet } from "svelte";
  import type { HTMLAttributes } from "svelte/elements";
  import * as Card from "#lib/components/ui/card/index.js";

  let {
    element = "div",
    class: className,
    children,
    ...rest
  }: HTMLAttributes<HTMLElement> & { element?: "div" | "section"; children: Snippet } = $props();

  // Outside a drill-in a page's sections stand on whatever holds them.
  const on = inDrillIn() ? levelCards() : () => false;
</script>

{#if on()}
  <Card.Root {element} {...rest} class={["gap-0 overflow-clip py-0 empty:hidden", className]}
    >{@render children()}</Card.Root
  >
{:else}
  <svelte:element this={element} {...rest} class={["empty:hidden", className]}
    >{@render children()}</svelte:element
  >
{/if}
