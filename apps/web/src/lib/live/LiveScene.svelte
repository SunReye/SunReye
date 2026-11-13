<script lang="ts">
  import type { Capabilities, Core, Layout, ModuleType, Values } from "../api/core.ts";
  import { parseView, presetView, type View } from "../builder/camera.ts";
  import { panels } from "../builder/modules.ts";
  import { sunAt, type Location, type Point, type Pv, type Scene } from "../builder/pv.ts";
  import SceneCanvas, { type Projector } from "../builder/SceneCanvas.svelte";
  import { motion } from "../motion/tier.svelte.ts";
  import { m } from "../paraglide/messages.js";
  import { spread } from "./chips.ts";
  import LabelChip from "./LabelChip.svelte";
  import { liveScene } from "./labels.ts";

  let {
    core,
    pv,
    layout,
    scene,
    moduleTypes,
    capabilities,
    model,
    location,
    locked = false,
    onselect,
    onready,
    onerror,
  }: {
    core: Core;
    pv: Pv;
    layout: Layout;
    /** The layout's scene. */
    scene: Scene;
    moduleTypes: readonly ModuleType[];
    capabilities: Capabilities | undefined;
    /** Reads an uploaded car body. */
    model?: Parameters<typeof SceneCanvas>[1]["model"];
    /** The plant's; unknown to a viewer, whose sun then stays put (ADR 20). */
    location?: Location | undefined;
    /** The camera stays put and a finger on the scene scrolls the page (ADR 20). */
    locked?: boolean;
    /** Opens a chip's detail sheet. */
    onselect: (id: string) => void;
    /** The first frame is on screen and the scene has started to fade in. */
    onready?: (() => void) | undefined;
    /** The scene could not be drawn. */
    onerror?: Parameters<typeof SceneCanvas>[1]["onerror"];
  } = $props();

  /** The first frame is drawn: the scene shows, chips included. */
  let ready = $state(false);

  /** The sun moves on every 15 minutes, as the spotlight backdrop does (ADR 21). */
  const SUN_STEP = 15 * 60_000;

  let now = $state(Date.now());

  $effect(() => {
    const timer = setInterval(() => {
      now = Date.now();
    }, SUN_STEP);

    return () => {
      clearInterval(timer);
    };
  });

  const sun = $derived(location === undefined ? null : sunAt(pv, location, now));

  /** Where each browser keeps its last view of the dashboard (ADR 20). */
  const KEPT = "sunreye.dashboard.view";

  let values = $state.raw<Values["devices"]>({});

  let stale = $state.raw<Values["stale"]>();

  let project = $state.raw<Projector>();

  let kept = $state.raw<View | undefined>(parseView(localStorage.getItem(KEPT)));

  $effect(() =>
    core.live((live) => {
      if ("devices" in live) {
        values = live.devices;
        stale = live.stale;
      }
    }),
  );

  // Drawn once per layout; a live tick changes only the tints and the labels.
  const geometry = $derived(pv.geometry(scene));

  const drawn = $derived.by(() => {
    const sizes = Object.fromEntries(
      moduleTypes.map(({ id, width, height }) => [id, { width, height }]),
    );

    return panels(scene, pv.modules(scene, sizes).grids);
  });

  const peaks = $derived(Object.fromEntries(moduleTypes.map(({ id, pmax }) => [id, pmax])));

  const estimated = $derived(
    Object.fromEntries(
      Object.entries(capabilities?.devices ?? {}).map(([id, device]) => [id, device.estimated]),
    ),
  );

  const live = $derived(
    liveScene({
      strings: layout.strings,
      peaks,
      panels: drawn,
      faces: geometry.faces,
      equipment: scene.equipment ?? [],
      mounts: geometry.mounts,
      estimated,
      values,
      stale,
      places: scene.carPlaces ?? [],
      stands: geometry.stands,
    }),
  );

  /** Where `point` lands on the canvas, or null behind the camera or before the first draw. */
  function at(point: Point | null): readonly [number, number] | null {
    return point === null ? null : (project?.(point) ?? null);
  }

  let width = $state(0);
  let height = $state(0);

  /** A chip's size until it is on screen (the prototype's). */
  const GUESS = { w: 90, h: 28 };

  /** Each chip's measured size, by key. */
  let sizes = $state<Record<string, { w: number; h: number }>>({});

  function measured(
    key: string,
    size: { w?: number | null | undefined; h?: number | null | undefined },
  ): void {
    const { w, h } = sizes[key] ?? GUESS;

    sizes[key] = { w: size.w ?? w, h: size.h ?? h };
  }

  /** Pixels a string's chip floats above its modules, on its leader line. */
  const LIFT = 42;

  /** The chips in view, pushed apart and inside the canvas (ADR 20). */
  const chips = $derived.by(() => {
    const shown = live.chips.flatMap((chip) => {
      const anchor = at(chip.anchor);

      return anchor === null ? [] : [{ chip, anchor, marker: at(chip.leader) }];
    });

    const boxes = spread(
      shown.map(({ chip, anchor: [x, y] }) => ({
        x,
        y: chip.kind === "string" ? y - LIFT : y,
        ...(sizes[chip.key] ?? GUESS),
      })),
      width,
      height,
    );

    return shown.map(({ chip, marker }, i) => ({ chip, marker, box: boxes[i]! }));
  });
</script>

<!-- Hidden and inert until the first frame is drawn; then all of it fades in, chips included. -->
<figure
  aria-label={m.live_scene()}
  class={[ready && "shown", motion.still && "instant"]}
  inert={!ready}
  bind:clientWidth={width}
  bind:clientHeight={height}
>
  <SceneCanvas
    {geometry}
    panels={drawn}
    shares={live.shares}
    cars={live.cars}
    {sun}
    {model}
    view={kept ?? presetView("isometric", geometry)}
    {locked}
    onview={(view) => {
      kept = view;
      localStorage.setItem(KEPT, JSON.stringify(view));
    }}
    onrender={(next) => {
      project = next;
    }}
    onready={() => {
      ready = true;
      onready?.();
    }}
    {onerror}
  />
  <!-- Chips are HTML over the canvas: readable through walls, and no redraw for new text. -->
  <svg class="pointer-events-none absolute inset-0 size-full overflow-visible" aria-hidden="true">
    {#each chips as { chip, marker, box } (chip.key)}
      {#if marker !== null}
        <line
          x1={marker[0]}
          y1={marker[1]}
          x2={box.x}
          y2={box.y}
          class="stroke-foreground/35"
          stroke-width="1"
        />
        <circle
          cx={marker[0]}
          cy={marker[1]}
          r="3"
          class="fill-background stroke-foreground/60"
          stroke-width="1.25"
        />
      {/if}
    {/each}
  </svg>
  {#each chips as { chip, box } (chip.key)}
    <div
      class="absolute top-0 left-0"
      style:transform="translate({box.x}px, {box.y}px) translate(-50%, -50%)"
      bind:offsetWidth={null, (w) => measured(chip.key, { w })}
      bind:offsetHeight={null, (h) => measured(chip.key, { h })}
    >
      <LabelChip {chip} {onselect} />
    </div>
  {/each}
</figure>

<style>
  figure {
    position: relative;
    margin: 0;
    height: 100%;
    overflow: hidden;
    /* Opacity only (ADR 21): an entrance, eased out. */
    opacity: 0;
    transition: opacity 350ms var(--motion-ease, ease-out);
  }
  figure.shown {
    opacity: 1;
  }
  figure.instant {
    transition: none;
  }
  @media (prefers-reduced-motion: reduce) {
    figure {
      transition: none;
    }
  }
</style>
