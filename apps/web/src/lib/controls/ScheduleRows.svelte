<!--
  The time-of-use schedule's page (ADR 21): one row per slot, from its start to the next slot's,
  each of its values a button that opens the value editor.
-->
<script lang="ts">
  import { m } from "../paraglide/messages.js";
  import { slotEnd, slots, type Control, type ControlGroup, type Slot } from "./groups.ts";
  import SlotValue from "./SlotValue.svelte";

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
    onedit: (control: Control, cell: HTMLElement) => void;
  } = $props();

  const rows = $derived(slots(group));

  const FIELDS = new Map([
    ["start", m.controls_field_start],
    ["power", m.controls_field_power],
    ["soc", m.controls_field_soc],
    ["grid_charge", m.controls_field_grid_charge],
  ]);

  /** A value's caption: its field, or the profile's name for a field Controls does not know. */
  function caption(control: Control): string {
    const field = control.setting.key.split(".").at(-1) ?? "";

    return FIELDS.get(field)?.() ?? control.setting.name ?? control.setting.key;
  }

  /** From its start to the next slot's. */
  function span(slot: Slot): string {
    const end = slotEnd(slot, rows);

    return slot.start && end ? `${text(slot.start)}–${text(end)}` : "";
  }

  /** Why its values are read-only while they wait for the admin's enable (ADR 8), else its device. */
  function note(slot: Slot): string | undefined {
    const first = slot.controls[0];

    if (slot.controls.some((c) => c.awaiting)) return m.controls_needs_enable();

    return first && owner(first);
  }
</script>

<ul class="divide-y divide-border/60">
  {#each rows as slot (`${slot.device} ${slot.n}`)}
    {@const why = note(slot)}
    <li class="flex flex-col gap-2 px-4 py-3">
      <div class="flex items-baseline justify-between gap-3">
        <span class="text-[15px] leading-snug">{m.controls_slot({ n: slot.n })}</span>
        <span class="text-sm text-muted-foreground tabular-nums">{span(slot)}</span>
      </div>
      {#if why}<p class="text-xs text-muted-foreground">{why}</p>{/if}
      <div class="grid grid-cols-4 gap-1.5">
        {#each slot.controls as control (control.setting.key)}
          <SlotValue
            {control}
            caption={caption(control)}
            value={text(control)}
            active={editing === control}
            {onedit}
          />
        {/each}
      </div>
    </li>
  {/each}
</ul>
<p class="mt-auto border-t border-border/60 px-4 py-3 text-xs text-muted-foreground">
  {m.controls_footnote()}
</p>
