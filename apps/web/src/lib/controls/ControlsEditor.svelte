<!-- The value editor on a control: ADR 7's write, then the outcome's haptic and, when confirmed, a toast. -->
<script lang="ts">
  import { toast } from "svelte-sonner";
  import { MediaQuery } from "svelte/reactivity";
  import type { Core } from "../api/core";
  import { editable, type Outcome } from "../components/value-editor/editable.ts";
  import ValueEditor from "../components/value-editor/value-editor.svelte";
  import { haptics } from "../haptics.ts";
  import { m } from "../paraglide/messages.js";
  import { editorOutcome } from "../settings/outcomes";
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

  async function apply(written: Control, next: number): Promise<Outcome> {
    const before = text(written);
    const result = await core.write(written.device, written.setting.key, next);
    const outcome = editorOutcome(result);

    await onwritten(written);

    if (outcome.kind === "confirmed") {
      haptics.success();
      toast.success(`${written.setting.name ?? written.setting.key}: ${text(written)}`, {
        description: m.controls_confirmed({ before }),
      });
    } else haptics.error();

    return outcome;
  }
</script>

{#if control}
  {@const shown = control}
  <ValueEditor
    key={`${shown.device} ${shown.setting.key}`}
    edit={editable(shown.setting)}
    current={value(shown)}
    {anchor}
    bind:open
    onapply={(next) => apply(shown, next)}
    below={split.current}
  />
{/if}
