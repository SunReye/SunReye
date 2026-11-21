<!--
  A level pushed inside a drill-in level or the builder's inspector (ADR 21): the drill-in's push.
  A deeper level slides in from the right while the one it leaves shifts left and dims; back
  slides it out again, and an edge-swipe follows the finger back. Each level draws its own
  `DrillHeader`. Only a level on screen is drawn: the one above shows only while one slides.
-->
<script lang="ts">
  import { untrack, type Snippet } from "svelte";
  import { Push } from "./push.svelte.ts";

  let {
    at,
    depth,
    up,
    onback,
    level,
    class: className,
  }: {
    /** The level shown, by key. */
    at: string;
    /** How deep `at` is: a deeper level, or one as deep, slides in; a shallower one is gone back to. */
    depth: number;
    /** The level above `at`, which a swipe back shows; null at the top. */
    up: string | null;
    /** Go back to `up`, as a swipe let go past halfway asks. */
    onback: () => void;
    level: Snippet<[string]>;
    class?: string;
  } = $props();

  // Seeded from the props once; the effect below follows every later level.
  // svelte-ignore state_referenced_locally
  let over = $state(at);
  let under = $state<string | null>(null);

  // svelte-ignore state_referenced_locally
  let shownDepth = depth;

  const push = new Push(1, {
    grab: () => {
      under = up;
    },
    land: (to) => {
      if (to === 0 && under !== null) {
        over = under;
        push.jump(1);
      }

      under = null;
    },
    back: () => {
      onback();
    },
  });

  $effect(() => {
    const next = at;
    const deep = depth;

    untrack(() => {
      if (next === over) {
        // Back to the level that was leaving: the slide turns where it is.
        if (push.target === 0) push.slide(1);
      } else if (next === under) {
        if (push.target === 1) push.slide(0);
      } else if (deep >= shownDepth) {
        under = over;
        over = next;
        push.jump(0);
        push.slide(1);
      } else {
        under = next;
        push.slide(0);
      }

      shownDepth = deep;
    });
  });

  const layers = $derived(under === null ? [over] : [under, over]);
</script>

<div
  class={["grid touch-pan-y grid-cols-[minmax(0,1fr)] overflow-x-clip", className]}
  {...push.handlers(() => up !== null)}
  role="presentation"
>
  {#each layers as key (key)}
    {@const above = key === under}
    <section
      data-push={above ? "under" : "over"}
      class={["col-start-1 row-start-1 flex min-w-0 flex-col", !above && "z-10"]}
      style:transform={above ? `translateX(${-30 * push.p}%)` : `translateX(${(1 - push.p) * 100}%)`}
      style:opacity={above ? 1 - 0.6 * push.p : 1}
      inert={above}
    >
      {@render level(key)}
    </section>
  {/each}
</div>
