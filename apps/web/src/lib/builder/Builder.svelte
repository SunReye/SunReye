<!--
  The 3D house builder (ADR 20): the canvas takes the full height on the left, a glass drill-in
  inspector sits on the right. On a portrait tablet the inspector is a sheet pulled up over the
  canvas; a phone views only. A click on an object in 3D drills the inspector to it.
-->
<script lang="ts">
  import { MediaQuery } from "svelte/reactivity";
  import type { Core, Device, ModuleType } from "../api/core.ts";
  import { m } from "../paraglide/messages.js";
  import Inspector from "./Inspector.svelte";
  import InspectorSheet, { PEEK } from "./InspectorSheet.svelte";
  import type { Location, Pv } from "./pv.ts";
  import { Session, type Opening } from "./session.svelte.ts";
  import Templates from "./Templates.svelte";
  import { provideUploader } from "./upload.ts";
  import View from "./View.svelte";

  let {
    pv,
    core,
    start,
    moduleTypes,
    devices,
    location,
  }: {
    pv: Pv;
    core: Core;
    /** The layout in force, or an empty one: nothing to undo before it. */
    start: Opening["start"];
    moduleTypes: readonly ModuleType[];
    /** What equipment markers may name. */
    devices: readonly Device[];
    /** Unknown to a viewer: the sun stays put and no clear sky is run. */
    location?: Location | undefined;
  } = $props();

  // Desktop and tablet edit; a phone views (ADR 20).
  const phone = new MediaQuery("max-width: 40rem");
  const portrait = new MediaQuery("orientation: portrait");

  const session = new Session(() => ({ pv, core, start, moduleTypes, devices }));

  provideUploader((glb) => core.uploadCarBody(glb));

  const sheet = $derived(!phone.current && portrait.current);

  const editing = $derived(phone.current ? undefined : session.editing);

  const painting = $derived(phone.current ? undefined : session.painting);
</script>

<div
  class={[
    "relative grid h-dvh min-h-[480px] gap-3 p-3",
    !phone.current && !sheet && "grid-cols-[minmax(0,1fr)_minmax(320px,380px)]",
  ]}
>
  <div class="relative min-h-0">
    <View
      {pv}
      {core}
      draft={session.draft}
      geometry={session.geometry}
      panels={session.panels}
      {moduleTypes}
      {devices}
      {location}
      clear={sheet ? PEEK : 0}
      {editing}
      {painting}
      onpick={phone.current
        ? undefined
        : (hit) => {
            session.pick(hit);
          }}
    />
    {#if !phone.current && session.offering}
      <Templates
        {pv}
        clear={sheet ? PEEK : 0}
        onpick={(template) => {
          session.begin(template);
        }}
      />
    {/if}
  </div>
  {#if phone.current}
    <p
      class="glass-ambient absolute inset-x-6 bottom-6 rounded-md px-3 py-2 text-sm text-muted-foreground"
    >
      {m.builder_view_only()}
    </p>
  {:else if sheet}
    <InspectorSheet bind:expanded={session.expanded}>
      <Inspector {session} {moduleTypes} />
    </InspectorSheet>
  {:else}
    <aside
      aria-label={m.builder_edit()}
      class="glass-ambient min-h-0 overflow-hidden rounded-lg border border-border/60 elevation-1"
    >
      <Inspector {session} {moduleTypes} />
    </aside>
  {/if}
</div>
