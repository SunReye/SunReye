<script lang="ts" module>
  /** Today in the browser's calendar, as a date input holds it. */
  function today(): string {
    const now = new Date();

    return [now.getFullYear(), now.getMonth() + 1, now.getDate()]
      .map((part) => String(part).padStart(2, "0"))
      .join("-");
  }
</script>

<script lang="ts">
  import { MediaQuery } from "svelte/reactivity";
  import type { Core, Device, Layout, ModuleType, Problem } from "../api/core.ts";
  import { m } from "../paraglide/messages.js";
  import { parseView, presetView, presets, type Preset, type View } from "./camera.ts";
  import { begin, record, redo, undo, type Edits } from "./history.ts";
  import { painted, panels, type Draft } from "./modules.ts";
  import Editor from "./Editor.svelte";
  import Outcome from "./Outcome.svelte";
  import type { Pv } from "./pv.ts";
  import SceneCanvas from "./SceneCanvas.svelte";

  let {
    pv,
    core,
    start,
    moduleTypes,
    devices,
  }: {
    pv: Pv;
    core: Core;
    /** The layout in force, or an empty one: nothing to undo before it. */
    start: Draft;
    moduleTypes: readonly ModuleType[];
    /** What equipment markers may name. */
    devices: readonly Device[];
  } = $props();

  /** Where each browser keeps its last view (ADR 20). */
  const KEPT = "sunreye.builder.view";

  const labels: Readonly<Record<Preset, () => string>> = {
    north: m.view_north,
    east: m.view_east,
    south: m.view_south,
    west: m.view_west,
    top: m.view_top,
    isometric: m.view_isometric,
  };

  // Desktop and tablet edit; a phone views (ADR 20).
  const phone = new MediaQuery("max-width: 40rem");

  // The start is where this editing session begins; a later prop is a new session's.
  const opening = (): Edits<Draft> => begin(start);

  let history = $state.raw(opening());

  let kept = $state.raw<View | undefined>(parseView(localStorage.getItem(KEPT)));

  let appliesFrom = $state(today());

  let saved = $state.raw<Layout | Problem>();

  const draft = $derived(history.present);

  const sizes = $derived(
    Object.fromEntries(moduleTypes.map(({ id, width, height }) => [id, { width, height }])),
  );

  const geometry = $derived(pv.geometry(draft.scene));
  const laid = $derived(pv.modules(draft.scene, sizes));
  const drawn = $derived(panels(draft.scene, laid.grids));

  function change(next: Draft): void {
    history = record(history, next);
    saved = undefined;
  }

  function keep(view: View): void {
    kept = view;
    localStorage.setItem(KEPT, JSON.stringify(view));
  }

  /** One configuration change from the chosen day on (ADR 20); nothing left to undo after. */
  async function save(): Promise<void> {
    const strings = draft.strings.map((string, i) => ({ ...string, ...painted(draft.scene, i) }));

    saved = await core.changeLayout({
      appliesFrom: new Date(`${appliesFrom}T00:00`).toISOString(),
      strings,
      scene: draft.scene,
    });

    if (!("problem" in saved)) {
      history = begin({ scene: saved.scene ?? draft.scene, strings: saved.strings });
    }
  }
</script>

<section class="stage">
  <SceneCanvas
    {geometry}
    panels={drawn}
    view={kept ?? presetView("isometric", geometry)}
    onview={keep}
  />
  <nav aria-label={m.builder_views()}>
    {#each presets as preset (preset)}
      <button
        type="button"
        onclick={() => {
          keep(presetView(preset, geometry));
        }}>{labels[preset]()}</button
      >
    {/each}
  </nav>
</section>
{#if phone.current}
  <p>{m.builder_view_only()}</p>
{:else}
  <div class="editor">
    <div class="actions">
      <button
        type="button"
        disabled={history.past.length === 0}
        onclick={() => {
          history = undo(history);
        }}>{m.builder_undo()}</button
      >
      <button
        type="button"
        disabled={history.future.length === 0}
        onclick={() => {
          history = redo(history);
        }}>{m.builder_redo()}</button
      >
      <label>
        {m.builder_applies_from()}
        <input type="date" required bind:value={appliesFrom} />
      </label>
      <button type="button" disabled={appliesFrom === ""} onclick={save}>{m.builder_save()}</button>
    </div>
    <Outcome misplaced={laid.misplaced} {saved} />
    <Editor {draft} {laid} {moduleTypes} {devices} onchange={change} />
  </div>
{/if}

<style>
  .stage {
    display: grid;
    grid-template-rows: minmax(20rem, 70vh) auto;
    gap: 0.5rem;
  }

  nav,
  .actions {
    display: flex;
    flex-wrap: wrap;
    align-items: end;
    gap: 0.5rem;
  }

  .editor {
    display: grid;
    gap: 1rem;
    align-content: start;
  }
</style>
