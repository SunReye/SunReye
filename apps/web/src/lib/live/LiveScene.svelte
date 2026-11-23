<script lang="ts">
  import type { Capabilities, Layout, ModuleType } from "../api/core.ts";
  import {
    panels,
    parseView,
    presetView,
    SceneCanvas,
    sunAt,
    type Projector,
    type View,
  } from "@sunreye/builder";
  import type { Location, Point, Pv } from "@sunreye/pv-wasm";
  import type { Scene } from "@sunreye/scene";
  import type { Plant, SceneWeather } from "@sunreye/builder/canvas";
  import { motion } from "@sunreye/builder/motion";
  import { m } from "../paraglide/messages.js";
  import { arrange, Steady, type Box, type Frame, type Label } from "./chips.ts";
  import LabelChip from "./LabelChip.svelte";
  import { liveSceneNow, type Chip } from "./live-scene.svelte.ts";

  let {
    pv,
    layout,
    scene,
    moduleTypes,
    capabilities,
    model,
    location,
    diffuse,
    weather,
    locked = false,
    top = 0,
    onselect,
    onready,
    onerror,
  }: {
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
    /** How diffuse the sky's light is now, 0 to 1: the weather; null or none for a clear sky. */
    diffuse?: number | null | undefined;
    /** The scene's weather now for where the sun is and the share of its peak the plant makes
     * (ADR 23); none, clear and dry. */
    weather?: ((plant: Plant) => SceneWeather) | undefined;
    /** The camera stays put and a finger on the scene scrolls the page (ADR 20). */
    locked?: boolean;
    /** Pixels at the top the chips leave free: the hero's headline. */
    top?: number;
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

  let project = $state.raw<Projector>();

  let kept = $state.raw<View | undefined>(parseView(localStorage.getItem(KEPT)));

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
    liveSceneNow({
      strings: layout.strings,
      peaks,
      panels: drawn,
      equipment: scene.equipment ?? [],
      mounts: geometry.mounts,
      estimated,
      places: scene.carPlaces ?? [],
      stands: geometry.stands,
    }),
  );

  /** The scene's weather now. Snow covers the modules only while no string with a reading makes
   * anything to speak of. */
  const sky = $derived.by(() => {
    const read = live.shares.filter((share) => share !== null);

    return weather?.({ sun, share: read.length === 0 ? null : Math.max(...read) });
  });

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

  /** Strings stack above the house; the rest below it, inverter and battery nearest (ADR 20). */
  function row({ kind }: Chip): Pick<Label, "lane" | "group"> {
    if (kind === "string") return { lane: "above", group: 0 };

    return { lane: "below", group: kind === "inverter" || kind === "battery" ? 0 : 1 };
  }

  /** Pixels the camera may shift a chip's marker, or the house, before the chips follow. */
  const BAND = 16;

  const steady = new Steady(BAND);

  /** The canvas size the steady values were taken at. */
  let taken = "";

  /** The house and its cars on the canvas; the canvas's middle while none of it is in view. */
  function house(): Frame["house"] {
    const points = [
      ...geometry.faces.flatMap((face) => face.corners),
      ...live.cars.map((car) => car.at),
    ].flatMap((point) => {
      const on = at(point);

      return on === null ? [] : [on];
    });

    const across = points.map(([x]) => x);
    const down = points.map(([, y]) => y);
    const none = points.length === 0;

    return {
      left: steady.follow("house.left", none ? width / 2 : Math.min(...across)),
      right: steady.follow("house.right", none ? width / 2 : Math.max(...across)),
      top: steady.follow("house.top", none ? height / 2 : Math.min(...down)),
      bottom: steady.follow("house.bottom", none ? height / 2 : Math.max(...down)),
    };
  }

  /** Pixels from a chip's end to where a leader line may meet its edge. */
  const INSET = 10;

  /** Where a leader line from `marker` meets the chip: on the edge facing it, as near as it gets. */
  function tip(box: Box, [x, y]: readonly [number, number]): readonly [number, number] {
    const reach = Math.max(box.w / 2 - INSET, 0);

    return [
      Math.max(box.x - reach, Math.min(box.x + reach, x)),
      box.y + (y > box.y ? box.h / 2 : -box.h / 2),
    ];
  }

  /** The chips in view, in rows around the house (ADR 20). */
  const chips = $derived.by(() => {
    if (project === undefined) return [];

    // A new canvas size moves everything: the chips start from where it puts them.
    if (taken !== `${width}:${height}`) {
      steady.clear();
      taken = `${width}:${height}`;
    }

    const shown = live.chips.flatMap((chip) => {
      const marker = at(chip.leader);

      // Its modules, marker or car lie behind the camera.
      return chip.leader !== null && marker === null ? [] : [{ chip, marker }];
    });

    const boxes = arrange(
      shown.map(({ chip, marker }) => ({
        key: chip.key,
        ...(sizes[chip.key] ?? GUESS),
        ...row(chip),
        x: marker === null ? null : steady.follow(chip.key, marker[0]),
      })),
      { width, height, top, house: house() },
    );

    return shown.map(({ chip, marker }, i) => {
      const box = boxes[i]!;

      return { chip, marker, box, tip: marker === null ? null : tip(box, marker) };
    });
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
    halted={live.halted}
    cars={live.cars}
    {sun}
    {diffuse}
    weather={sky}
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
    {#each chips as { chip, marker, tip } (chip.key)}
      {#if marker !== null && tip !== null}
        <line
          x1={marker[0]}
          y1={marker[1]}
          x2={tip[0]}
          y2={tip[1]}
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
    transition: opacity var(--motion-enter) var(--motion-ease);
  }
  figure.shown {
    opacity: 1;
  }
  figure.instant {
    transition: none;
  }
</style>
