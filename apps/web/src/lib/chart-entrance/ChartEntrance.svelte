<!--
  A chart's entrance (ADR 21 "Chart entrance"): it builds up as its first data shows, once per mount.
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
    class: className,
    children,
  }: {
    build: Build;
    /** The first data is drawn. */
    ready: boolean;
    class?: ClassValue;
    children: Snippet;
  } = $props();

  /** Once per mount. */
  let started = false;

  /** The tokens are 0 on the still tier and under reduced motion: nothing to build. */
  const still = (el: HTMLElement) =>
    getComputedStyle(el).getPropertyValue("--motion-move").trim() === "0ms";

  // Set on the element itself, not through the template, so its animations exist at once.
  const enter: Attachment<HTMLElement> = (el) => {
    if (!ready || started) return;

    started = true;

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

<div class={["entrance", className]} data-build={build} {@attach enter}>
  <div class="back">{@render children()}</div>
</div>

<style>
  .back {
    position: relative;
    width: 100%;
    height: 100%;
  }

  .entrance:global([data-entrance="in"]) {
    animation: fade-in var(--motion-enter) var(--motion-ease) both;
  }

  /* A window sweeps in from the left over the plot, which the inner box holds in place. */
  .entrance:global([data-entrance="in"])[data-build="draw"] {
    overflow: hidden;
    animation-name: sweep-in;
  }
  .entrance:global([data-entrance="in"])[data-build="draw"] > .back {
    animation: hold-in var(--motion-enter) var(--motion-ease) both;
  }

  .entrance:global([data-entrance="in"])[data-build="grow"] :global([data-grow]) {
    animation: grow-in var(--motion-enter) var(--motion-ease)
      calc(var(--i, 0) * var(--motion-stagger)) both;
  }
  .entrance:global([data-entrance="in"])[data-build="grow"] :global([data-grow="x"]) {
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
