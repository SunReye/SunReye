<!--
  Controls (ADR 21): the devices' settings grouped by role namespace on the drill-in, each root row
  summarising the values read from the device. Every edit runs the value editor and ADR 7's funnel.
-->
<script lang="ts">
  import type { Core, Problem } from "../api/core";
  import LoadingRows from "../components/loading-rows.svelte";
  import { problemText } from "../i18n/problems";
  import { m } from "../paraglide/messages.js";
  import { getLocale } from "../paraglide/runtime.js";
  import { apply } from "./apply.ts";
  import ControlsDrill from "./ControlsDrill.svelte";
  import ControlsEditor from "./ControlsEditor.svelte";
  import { controlGroups, valueOf, type Control, type ControlGroup } from "./groups.ts";

  let {
    core,
    open,
    onnavigate,
  }: {
    core: Core;
    /** The open group's id, from the hash route; null on the root. */
    open: string | null;
    onnavigate: (id: string | null) => void;
  } = $props();

  interface Loaded {
    readonly groups: readonly ControlGroup[];
    /** Each device's name, when more than one has settings. */
    readonly names: ReadonlyMap<number, string>;
    /** Every device with settings has its writes on. */
    readonly writes: boolean;
  }

  /** Each control's value as the device last read it; `null` when unknown. */
  let values = $state<Record<string, number | null>>({});

  const id = (control: Control) => `${control.device} ${control.setting.key}`;

  async function read(control: Control): Promise<void> {
    const answer = await core.read(control.device, control.setting.key);

    values[id(control)] = "problem" in answer ? null : answer.value;
  }

  /** Groups the capabilities' settings and starts reading each value from its device. */
  async function load(): Promise<Loaded | Problem> {
    const answer = await core.capabilities();

    if ("problem" in answer) return answer;

    const groups = controlGroups(answer.devices);
    const controls = groups.flatMap((g) => g.controls);
    const owners = new Set(controls.map((c) => c.device));
    const devices = owners.size > 1 ? await core.devices() : [];
    const names = new Map(("problem" in devices ? [] : devices).map((d) => [d.id, d.name]));
    const writes = [...owners].every((device) => answer.devices[device]?.writes === true);

    for (const control of controls) void read(control);

    return { groups, names, writes };
  }

  const loading = $derived.by(() => load());

  const value = (control: Control) => values[id(control)] ?? null;

  function text(control: Control): string {
    const now = value(control);

    return now === null ? "–" : valueOf(control.setting, now, getLocale());
  }

  let editing = $state.raw<Control | null>(null);
  let anchor = $state.raw<HTMLElement | null>(null);
  let editorOpen = $state(false);

  function edit(control: Control, row: HTMLElement): void {
    editing = control;
    anchor = row;
    editorOpen = true;
  }

  /** A lock writes another setting, so every value of the written device is read again. */
  async function reread(written: Control, groups: readonly ControlGroup[]): Promise<void> {
    const device = groups.flatMap((g) => g.controls).filter((c) => c.device === written.device);

    await Promise.all(device.map((c) => read(c)));
  }
</script>

<!-- While the capabilities come, the root's card stands in skeleton rows of its size. -->
{#await loading}
  <main class="mx-auto flex w-full max-w-2xl flex-col gap-4 px-4 py-6">
    <h1 class="px-1 text-2xl font-semibold tracking-tight">{m.controls_title()}</h1>
    <div class="glass-ambient overflow-hidden rounded-lg border border-border/60 elevation-2">
      <LoadingRows rows={4} />
    </div>
  </main>
{:then loaded}
  {#if "problem" in loaded}
    <main class="mx-auto w-full max-w-2xl px-4 py-6">
      <p role="alert">{problemText(loaded.problem)}</p>
    </main>
  {:else}
    <ControlsDrill
      {...loaded}
      {open}
      {onnavigate}
      {value}
      {text}
      editing={editorOpen ? editing : null}
      onedit={edit}
      onset={(c, next) =>
        apply({ core, text, onwritten: (w) => reread(w, loaded.groups) }, c, next)}
    />
    <ControlsEditor
      {core}
      control={editing}
      {anchor}
      bind:open={editorOpen}
      {value}
      {text}
      onwritten={(c) => reread(c, loaded.groups)}
    />
  {/if}
{/await}
