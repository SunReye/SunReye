<script lang="ts">
  import type { Capabilities, Core, Layout, ModuleType, Values } from "../api/core.ts";
  import { parseView, presetView, type View } from "../builder/camera.ts";
  import { panels } from "../builder/modules.ts";
  import type { Point, Pv, Scene } from "../builder/pv.ts";
  import SceneCanvas, { type Projector } from "../builder/SceneCanvas.svelte";
  import { m } from "../paraglide/messages.js";
  import { getLocale } from "../paraglide/runtime.js";
  import FlowLabel from "./FlowLabel.svelte";
  import { liveScene } from "./labels.ts";
  import StringTag from "./StringTag.svelte";

  let {
    core,
    pv,
    layout,
    scene,
    moduleTypes,
    capabilities,
  }: {
    core: Core;
    pv: Pv;
    layout: Layout;
    /** The layout's scene. */
    scene: Scene;
    moduleTypes: readonly ModuleType[];
    capabilities: Capabilities | undefined;
  } = $props();

  /** Where each browser keeps its last view of the dashboard (ADR 20). */
  const KEPT = "sunreye.dashboard.view";

  let values = $state.raw<Values["devices"]>({});

  let project = $state.raw<Projector>();

  let kept = $state.raw<View | undefined>(parseView(localStorage.getItem(KEPT)));

  $effect(() =>
    core.live((live) => {
      if ("devices" in live) values = live.devices;
    }),
  );

  const format = new Intl.NumberFormat(getLocale(), { maximumFractionDigits: 0 });

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
    }),
  );

  /** Where `point` lands on the canvas, or null behind the camera or before the first draw. */
  function at(point: Point | null): readonly [number, number] | null {
    return point === null ? null : (project?.(point) ?? null);
  }

  /** Each leader line, from its label down to its marker, both in view. */
  const leaders = $derived(
    live.labels.flatMap(({ anchor, leader }) => {
      const [from, to] = [at(anchor), at(leader)];

      return from === null || to === null ? [] : [[from, to] as const];
    }),
  );
</script>

<figure aria-label={m.live_scene()}>
  <SceneCanvas
    {geometry}
    panels={drawn}
    shares={live.shares}
    view={kept ?? presetView("isometric", geometry)}
    onview={(view) => {
      kept = view;
      localStorage.setItem(KEPT, JSON.stringify(view));
    }}
    onrender={(next) => {
      project = next;
    }}
  />
  <!-- Labels are HTML over the canvas: readable through walls, and no redraw for new text. -->
  <svg aria-hidden="true">
    {#each leaders as [from, to], i (i)}
      <line x1={from[0]} y1={from[1]} x2={to[0]} y2={to[1]} />
    {/each}
  </svg>
  {#each live.strings as string, i (i)}
    {@const spot = at(string.centre)}
    {#if spot !== null}
      <StringTag {string} at={spot} {format} />
    {/if}
  {/each}
  {#each live.labels as label, i (i)}
    {@const spot = at(label.anchor)}
    {#if spot !== null && label.quantities.length > 0}
      <FlowLabel quantities={label.quantities} at={spot} {format} />
    {/if}
  {/each}
</figure>

<style>
  figure {
    position: relative;
    margin: 0;
    height: 70vh;
    min-height: 20rem;
    overflow: hidden;
  }

  svg {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
  }

  line {
    stroke: #1d232b;
    stroke-width: 1.5;
  }
</style>
