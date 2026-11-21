<!--
  A chart's entrance (ADR 21 "Chart entrance"): it builds up as its first data shows, once per mount
  and once per `key`: a chart keyed by what it draws builds again when that changes.
  - `grow`: bars grow from their baseline, each a little after the one before. A bar opts in with
    `data-grow` (`data-grow="x"` grows sideways), sets its `transform-origin` at its baseline and
    `--i`, its place in the stagger from 0 to 1.
  - `draw`: lines, areas and canvases draw in from the left.
  - `fade`: a chart that grows live; a tick must never redraw it.
  Everything fades in. Only `scale`, `translate` and `opacity` move, on the motion tokens, so the
  still tier and reduced motion draw the chart at once. Later data arrives as the chart tweens it:
  bars keyed anew after the entrance appear in place.
-->
<script lang="ts" module>
  export type Build = "grow" | "draw" | "fade";
</script>

<script lang="ts">
  import type { Snippet } from "svelte";
  import type { Attachment } from "svelte/attachments";
  import type { ClassValue } from "svelte/elements";

  let {
    build,
    ready,
    key,
    class: className,
    children,
  }: {
    build: Build;
    /** The first data is drawn. */
    ready: boolean;
    /** What the chart draws, when a change of it builds the chart again (ADR 21, Explore's charts). */
    key?: unknown;
    class?: ClassValue;
    children: Snippet;
  } = $props();

  /** Each frame, a mount or a key, builds once. */
  const started = new WeakSet<HTMLElement>();

  /** The tokens are 0 on the still tier and under reduced motion: nothing to build. */
  const still = (el: HTMLElement) =>
    getComputedStyle(el).getPropertyValue("--motion-move").trim() === "0ms";

  // Set on the element itself, not through the template, so its animations exist at once.
  const enter: Attachment<HTMLElement> = (el) => {
    if (!ready || started.has(el)) return;

    started.add(el);

    if (still(el)) return;

    el.dataset["entrance"] = "in";

    // Over once every part has built: from then on a bar keyed anew appears in place. A live dot
    // pulses for good and would hold it open.
    const built = el
      .getAnimations({ subtree: true })
      .filter(
        (a) => a instanceof CSSAnimation && a.effect?.getComputedTiming().endTime !== Infinity,
      )
      .map((a) => a.finished);

    void Promise.allSettled(built).then(() => delete el.dataset["entrance"]);
  };
</script>

<div class={["entrance", className]} data-build={build}>
  {#key key}
    <div class="frame" {@attach enter}>
      <div class="back">{@render children()}</div>
    </div>
  {/key}
</div>

<style>
  .frame,
  .back {
    position: relative;
    width: 100%;
    height: 100%;
  }

  .frame:global([data-entrance="in"]) {
    animation: fade-in var(--motion-enter) var(--motion-ease) both;
  }

  /* A window sweeps in from the left over the plot, which the inner box holds in place. */
  [data-build="draw"] > .frame:global([data-entrance="in"]) {
    overflow: hidden;
    animation-name: sweep-in;
  }
  [data-build="draw"] > .frame:global([data-entrance="in"]) > .back {
    animation: hold-in var(--motion-enter) var(--motion-ease) both;
  }

  [data-build="grow"] > .frame:global([data-entrance="in"]) :global([data-grow]) {
    animation: grow-in var(--motion-enter) var(--motion-ease)
      calc(var(--i, 0) * var(--motion-stagger)) both;
  }
  [data-build="grow"] > .frame:global([data-entrance="in"]) :global([data-grow="x"]) {
    animation-name: grow-x-in;
  }

  @keyframes fade-in {
    from {
      opacity: 0;
    }
  }
  @keyframes sweep-in {
    from {
      opacity: 0;
      translate: -100% 0;
    }
  }
  @keyframes hold-in {
    from {
      translate: 100% 0;
    }
  }
  @keyframes grow-in {
    from {
      opacity: 0;
      scale: 1 0;
    }
  }
  @keyframes grow-x-in {
    from {
      opacity: 0;
      scale: 0 1;
    }
  }
</style>
