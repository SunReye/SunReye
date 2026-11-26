<!-- A group's settings, each row its current value, and where the limits come from (ADR 21). -->
<script lang="ts">
  import * as Item from "@sunreye/ui/item";
  import { m } from "../paraglide/messages.js";
  import ControlRow from "./ControlRow.svelte";
  import type { Control, ControlGroup } from "./groups.ts";

  let {
    group,
    text,
    owner,
    editing,
    onedit,
  }: {
    group: ControlGroup;
    /** A control's current value as text; a dash while unknown. */
    text: (control: Control) => string;
    /** The device a control belongs to, when more than one has settings. */
    owner: (control: Control) => string | undefined;
    /** The control the editor has open. */
    editing: Control | null;
    onedit: (control: Control, row: HTMLElement) => void;
  } = $props();

  /** Why it is read-only while it waits for the admin's enable (ADR 8), else its device. */
  function note(control: Control): string | undefined {
    return control.awaiting ? m.controls_needs_enable() : owner(control);
  }
</script>

<Item.Group class="gap-0 divide-y divide-border/60">
  {#each group.controls as control (`${control.device} ${control.setting.key}`)}
    <ControlRow
      {control}
      value={text(control)}
      note={note(control)}
      active={editing === control}
      {onedit}
    />
  {/each}
</Item.Group>
<p class="mt-auto border-t border-border/60 px-4 py-3 text-xs text-muted-foreground">
  {m.controls_footnote()}
</p>
