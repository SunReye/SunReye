<!--
  The 3D house builder (ADR 20): the canvas takes the full height on the left, a glass drill-in
  inspector sits on the right. On a portrait tablet or a phone the inspector is a sheet pulled up
  over the canvas. A click on an object in 3D drills the inspector to it.
-->
<script lang="ts" module>
  /** The builder's height, which its placeholder takes while it loads (ADR 21). */
  export const BUILDER_SIZE = "h-[calc(100dvh-var(--bar-clear,0px))] min-h-[480px]";
</script>

<script lang="ts">
  import { MediaQuery } from "svelte/reactivity";
  import type { Core, Device, ModuleType } from "../api/core.ts";
  import InspectorPane, { PEEK } from "./InspectorPane.svelte";
  import { Moment } from "./moment.svelte.ts";
  import type { Aerial, Location, Neighbour, Pv } from "@sunreye/builder/builder/pv.ts";
  import PhoneTools from "./PhoneTools.svelte";
  import { Session, type Reads } from "./session.svelte.ts";
  import Templates from "./Templates.svelte";
  import { provideUploader } from "./upload.ts";
  import View from "./View.svelte";

  let {
    pv,
    core,
    start,
    types,
    moduleTypes,
    devices,
    location,
    limits = {},
    inputs = {},
    aerial,
    neighbours = [],
  }: {
    pv: Pv;
    core: Core;
    /** The layout in force, or an empty one: nothing to undo before it. */
    start: Reads["start"];
    /** The layout in force's inverter and battery types, which a save keeps. */
    types?: Reads["types"];
    moduleTypes: readonly ModuleType[];
    /** What equipment markers may name. */
    devices: readonly Device[];
    /** Unknown to a viewer: the sun stays put and no clear sky is run. */
    location?: Location | undefined;
    /** Each inverter's maximum DC input voltage, by device id; a viewer knows none. */
    limits?: Reads["limits"];
    /** Each inverter's MPPT inputs' limits, by device id; a viewer knows none. */
    inputs?: Reads["inputs"];
    /** An aerial image, north up, draped on the ground and the roof faces; Home supplies none
     * (ADR 20, 25). Decoded by the consumer: the builder loads nothing. */
    aerial?: Aerial | undefined;
    /** Bodies around the plant that shade as its obstacles do; never saved. */
    neighbours?: readonly Neighbour[];
  } = $props();

  // Every width edits (ADR 20): a phone with the inspector as a sheet and "+" on the canvas.
  const phone = new MediaQuery("max-width: 40rem");
  const portrait = new MediaQuery("orientation: portrait");

  const session = new Session(() => ({
    pv,
    core,
    start,
    types,
    moduleTypes,
    devices,
    limits,
    inputs,
  }));

  /** The time slider's instant: it reads the draft, never writes it. */
  const moment = new Moment(
    () => ({
      core,
      pv,
      location,
      neighbours,
      draft: session.draft,
      moduleTypes: session.moduleTypes,
    }),
    // Handles to drag, or a face to lay and wire: faces and edges stay exact (ADR 23).
    () => session.editing !== undefined || session.roofwork !== undefined,
  );

  provideUploader((glb) => core.uploadCarBody(glb));

  const sheet = $derived(phone.current || portrait.current);

  const around = $derived({
    aerial,
    neighbours: neighbours.length === 0 ? [] : pv.neighbours(neighbours),
  });
</script>

<!-- A phone's canvas runs edge to edge; the shell's bottom bar, if any, sets `--bar-clear`. Clipped:
  the peeking sheet's rest must not show behind that bar. -->
<div
  class={[
    "relative grid overflow-clip",
    BUILDER_SIZE,
    !phone.current && "gap-3 p-3",
    !sheet && "grid-cols-[minmax(0,1fr)_minmax(320px,380px)]",
  ]}
>
  <div class="relative min-h-0">
    <View
      {core}
      draft={session.draft}
      geometry={session.geometry}
      panels={session.panels}
      {around}
      {devices}
      {location}
      {moment}
      clear={sheet ? PEEK : 0}
      covered={sheet && session.expanded}
      editing={session.editing}
      roofwork={session.roofwork}
      onto={phone.current ? session.wiring.onto : undefined}
      tools={phone.current ? tools : undefined}
      selected={session}
      onpick={(hit) => {
        session.pick(hit, phone.current);
      }}
    />
    {#if session.offering}
      <Templates
        {pv}
        draft={session.draft}
        clear={sheet ? PEEK : 0}
        onpick={(filled) => {
          session.begin(filled);
        }}
      />
    {/if}
  </div>
  <InspectorPane {session} {sheet} {core} {devices} at={moment.at} />
</div>

{#snippet tools()}
  <PhoneTools {session} moduleType={session.moduleTypes[0]?.id} />
{/snippet}
