<!--
  One band in the plot: a bar of stacked segments with its reference mark and a hatch where readings
  are missing, or a hatched gap. A 24 px box at the plot's origin, placed and sized by its transform.
-->
<script lang="ts">
  import { MARK, type View } from "./bands.ts";
  import type { Kept } from "./presence.svelte.ts";

  let {
    k,
    ghost,
    level,
    stagger,
  }: {
    k: Kept<View>;
    /** The colour of the faint bar of a band still to come. */
    ghost: string;
    /** A value's place on the scale, in % from the top. */
    level: (v: number) => number;
    /** Its turn in the stagger, 0 to 1: how long it waits as it arrives or builds. */
    stagger: number;
  } = $props();

  const o = $derived(k.item);

  // The faint bar of what a band still to come expects, under the segments.
  const stack = $derived([
    ...(o.ghost === null ? [] : [{ colour: ghost, transform: o.ghost, faint: true }]),
    ...o.segs.map((g) => ({ ...g, faint: false })),
  ]);

  const states = $derived([k.out && "out", k.fresh >= 0 && "fresh"]);

  const hatch = $derived({
    width: `${(o.slot * 0.76).toFixed(2)}px`,
    x: `${(o.cx - o.slot * 0.38).toFixed(2)}px`,
    x0: `${(o.cx0 - o.slot * 0.38).toFixed(2)}px`,
  });

  // A reference on the upper side: it draws across the bar as it appears and fades as it goes.
  const mark = $derived.by(() => {
    const at = o.b.mark ?? null;
    const on = at !== null && o.b.state !== "future" && o.b.state !== "before" && !k.out;
    const width = Math.min(MARK, o.slot * 0.84);
    const scale = on ? (width / MARK).toFixed(4) : "0";

    return {
      on,
      opacity: on ? 1 : 0,
      transform: `translate(${(o.cx - width / 2).toFixed(2)}px, ${level(at ?? 0).toFixed(3)}%) scaleX(${scale})`,
    };
  });
</script>

{#if o.b.state === "gap"}
  <span
    class={["gap hatch", ...states]}
    style:width={hatch.width}
    style:transform="translateX({hatch.x})"
    style:--x0={hatch.x0}
  ></span>
{:else}
  <span
    class={["bar", ...states, o.zoom && "zoom"]}
    style:transform="translateX({o.x.toFixed(2)}px) scaleX({o.sx.toFixed(4)}) scaleY({o.sy})"
    style:--x0="{o.x0.toFixed(2)}px"
    style:--sx0={o.sx0.toFixed(4)}
    style:--sy0={o.sy0}
    style:--i={stagger.toFixed(3)}
    data-grow
  >
    {#each stack as g, j (j)}
      <span
        class={["seg", g.faint && "opacity-30"]}
        style:background={g.colour}
        style:transform={g.transform}
      ></span>
    {/each}
  </span>
  <span
    class={["mark", mark.on && "on"]}
    style:opacity={mark.opacity}
    style:transform={mark.transform}
  >
    <span class="absolute top-0 left-0 h-0.5 w-full -translate-y-1/2 bg-foreground/70"></span>
  </span>
  {#if o.b.partial}
    <span
      class={["gap hatch bottom-0 h-1.5", k.out && "out"]}
      style:top="auto"
      style:width={hatch.width}
      style:transform="translateX({hatch.x})"
    ></span>
  {/if}
{/if}

<style>
  /* A bar: a 24 px box at the plot's origin, placed and sized by its transform. */
  .bar {
    position: absolute;
    inset: 0 auto 0 0;
    width: 24px;
    transform-origin: 0 var(--zero);
    transition:
      transform var(--move),
      opacity var(--move);
  }
  /* Arriving: grown from the baseline beside the bars that move, each a little after the one before. */
  .bar.fresh {
    --delay: calc(var(--i) * var(--motion-stagger));
    transition:
      transform var(--move) var(--delay),
      opacity var(--move) var(--delay);
  }
  /* Leaving: shorter than the entrance, on ease-in. */
  .bar.out {
    opacity: 0;
    transition:
      transform var(--motion-exit) var(--motion-ease-exit),
      opacity var(--motion-exit) var(--motion-ease-exit);
  }
  /* A zoom is a movement between two places: both sides travel on ease-in-out. */
  .bar.zoom {
    transition:
      transform var(--move),
      opacity var(--move);
  }
  @starting-style {
    .bar.fresh {
      transform: translateX(var(--x0)) scaleX(var(--sx0)) scaleY(var(--sy0));
      opacity: 0;
    }
  }
  .seg {
    position: absolute;
    inset: 0;
    transform-origin: top;
    transition: transform var(--move);
  }

  .mark {
    position: absolute;
    inset: 0 auto 0 0;
    width: 32px;
    transform-origin: 0 0;
    pointer-events: none;
    transition:
      transform var(--move),
      opacity var(--motion-base) var(--motion-ease);
  }
  /* A reference draws in once its bar is nearly there. */
  .mark.on {
    transition:
      transform var(--move),
      opacity var(--motion-base) var(--motion-ease) calc(var(--motion-move) / 2);
  }
  @starting-style {
    .mark {
      opacity: 0;
    }
  }

  /* No readings: hatched, so it never reads as zero. Its stripes must not stretch: it is placed, not scaled. */
  .gap {
    position: absolute;
    inset: 0 auto 0 0;
    transition:
      transform var(--move),
      opacity var(--motion-base) var(--motion-ease);
  }
  .gap.out {
    opacity: 0;
    transition:
      transform var(--move),
      opacity var(--motion-exit) var(--motion-ease-exit);
  }
  @starting-style {
    .gap.fresh {
      transform: translateX(var(--x0));
      opacity: 0;
    }
  }
  .hatch {
    background: repeating-linear-gradient(
      135deg,
      color-mix(in oklab, var(--foreground) 22%, transparent) 0 1px,
      transparent 1px 5px
    );
  }

  :global(.still) :is(.bar, .seg, .mark, .gap) {
    transition: none;
  }
</style>
