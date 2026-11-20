<!--
  A range card's content, which travels (ADR 21): a finger drags it 1:1 with the neighbour beside
  it, drawn loading, and on release a spring takes over; each step a finger takes is a `selection`.
  An arrow's step or a new kind morphs it in place. Outside a range card it never drags.
-->
<script lang="ts" module>
  import type { Travel } from "./travel.svelte.ts";

  /** What a pane travels by; a card's `RangeTravel` is one. */
  export interface Paging<D> {
    /** What tells one pane from the next. */
    readonly id: string;
    /** Null before the first figures. */
    readonly pane: D | null;
    readonly peek: (dir: -1 | 1) => { id: string; data: D } | null;
    /** A finger paged the range. */
    readonly drag: (dir: -1 | 1) => void;
    readonly travel: () => Travel;
  }
</script>

<script lang="ts" generics="D">
  import type { Snippet } from "svelte";
  import { haptics } from "../haptics.ts";
  import { cardOf } from "./card-surface.ts";
  import Pager from "./Pager.svelte";

  let {
    model,
    defer = false,
    waiting,
    children,
  }: {
    model: Paging<D>;
    /** Heavy content: build what fades in two frames after the switch. */
    defer?: boolean;
    /** Before the first figures. */
    waiting?: Snippet;
    children: Snippet<[D]>;
  } = $props();

  const card = cardOf();
</script>

{#if model.pane}
  <Pager
    surface={card?.el ?? null}
    id={model.id}
    data={model.pane}
    travel={model.travel}
    peek={model.peek}
    {defer}
    onstep={(dir) => {
      haptics.selection();
      model.drag(dir);
    }}
    {children}
  />
{:else}
  {@render waiting?.()}
{/if}
