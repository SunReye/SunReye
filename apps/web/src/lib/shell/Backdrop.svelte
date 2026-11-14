<!--
  Behind every page: four soft lights under the glass (ADR 21). The sun light takes the core's
  tint, sent to every role (indigo without the plant's location); the PV light glows with live
  production; battery and grid sit low, under the bar and the rail. They drift on the full tier only,
  a step a second: each move makes every glass surface above it blur again, and a running
  animation would do that every frame.
-->
<script lang="ts">
  import type { PvModel } from "../api/model.ts";
  import { stream } from "../live/stream.svelte.ts";
  import { motion } from "../motion/tier.svelte.ts";
  import { beat as everySecond, LIGHTS, pose, pvGlow, type Beat } from "./lights.ts";
  import { watchTint } from "./spotlight.ts";

  let { core, beat = everySecond }: { core: Pick<PvModel, "sunTint">; beat?: Beat } = $props();

  const glow = $derived(pvGlow(stream.plant?.["pv.power"]));
  const drifting = $derived(motion.tier === "full");

  /** Seconds into the drift; the lights rest at 0. */
  let seconds = $state(0);

  $effect(() => {
    if (!drifting) return;

    const stop = beat((now) => {
      seconds = now;
    });

    return () => {
      stop();
      seconds = 0;
    };
  });

  $effect(() => {
    const root = document.documentElement;

    const stop = watchTint({
      read: () => core.sunTint(),
      set: (tint) => {
        if (tint === undefined) delete root.dataset["tod"];
        else root.dataset["tod"] = tint;
      },
    });

    return () => {
      stop();
      delete root.dataset["tod"];
    };
  });
</script>

<div
  class={[
    "pointer-events-none fixed inset-0 -z-10 overflow-hidden bg-background",
    { drifting },
  ]}
  aria-hidden="true"
>
  {#each LIGHTS as light (light)}
    {@const { transform, opacity } = pose(light, seconds)}
    <div data-light={light} style:opacity={light === "pv" ? glow : undefined}>
      <div class={{ "bg-spotlight": light === "sun" }} style:transform style:opacity></div>
    </div>
  {/each}
</div>

<style>
  /* The outer box places a light and carries the PV glow; only the inner one's transform and
     opacity move (ADR 21). */
  [data-light] {
    position: absolute;
    left: var(--x);
    top: var(--y);
    width: var(--size);
    aspect-ratio: 1;
    translate: -50% -50%;
  }

  [data-light] > div {
    width: 100%;
    height: 100%;
  }

  /* The sun light is app.css's bg-spotlight. */
  [data-light]:not([data-light="sun"]) > div {
    background: radial-gradient(
      closest-side,
      var(--light),
      color-mix(in oklch, var(--light) 45%, transparent) 50%,
      transparent
    );
  }

  [data-light="sun"] {
    inset: 0;
    width: auto;
    aspect-ratio: auto;
    translate: none;
  }

  [data-light="pv"] {
    --light: var(--light-pv);
    --x: 88%;
    --y: 20%;
    --size: 85vmax;
  }

  [data-light="battery"] {
    --light: var(--light-battery);
    --x: 8%;
    --y: 88%;
    --size: 90vmax;
  }

  [data-light="grid"] {
    --light: var(--light-grid);
    --x: 92%;
    --y: 80%;
    --size: 75vmax;
  }

  .drifting [data-light] {
    /* A change in production comes on over seconds, in the lights' own beat. */
    transition: opacity 4s steps(4);
  }
</style>
