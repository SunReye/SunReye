<!-- The value editor on a control: ADR 7's write, then the outcome's haptic and, when confirmed, a toast. -->
<script lang="ts">
  import { MediaQuery } from "svelte/reactivity";
  import type { Core } from "../api/core";
  import { editable } from "../components/value-editor/editable.ts";
  import ValueEditor from "../components/value-editor/value-editor.svelte";
  import { apply } from "./apply.ts";
  import type { Control } from "./groups.ts";

  let {
    core,
    control,
    anchor,
    open = $bindable(false),
    value,
    text,
    onwritten,
  }: {
    core: Core;
    /** The control last opened; none before the first. */
    control: Control | null;
    anchor: HTMLElement | null;
    open?: boolean;
    /** A control's value as the device last read it; `null` when unknown. */
    value: (control: Control) => number | null;
    /** A control's current value as text. */
    text: (control: Control) => string;
    /** Reads the device again after a write, whatever its outcome. */
    onwritten: (control: Control) => Promise<void>;
  } = $props();

  // The drill-in's own breakpoint: two panes open the editor under the row's value (ADR 21).
  const split = new MediaQuery("(min-width: 1024px)");
</script>

{#if control}
  {@const shown = control}
  <ValueEditor
    key={`${shown.device} ${shown.setting.key}`}
    edit={editable(shown.setting)}
    current={value(shown)}
    {anchor}
    bind:open
    onapply={(next) => apply({ core, text, onwritten }, shown, next)}
    below={split.current}
  />
{/if}
