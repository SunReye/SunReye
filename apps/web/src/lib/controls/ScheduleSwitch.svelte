<!--
  A switch of the time-of-use schedule, such as the one turning every slot on (ADR 21). A toggle
  writes through ADR 7's funnel at once; it shows the device's value again once the write ends.
-->
<script lang="ts">
  import { Checkbox } from "#lib/components/ui/checkbox/index.js";
  import * as Item from "#lib/components/ui/item/index.js";
  import type { Outcome } from "../components/value-editor/editable.ts";
  import WriteProblem from "../components/value-editor/write-problem.svelte";
  import { m } from "../paraglide/messages.js";
  import type { Control } from "./groups.ts";

  let {
    control,
    value,
    label,
    onset,
  }: {
    control: Control;
    /** The device's value; `null` while unknown. */
    value: number | null;
    label: string;
    /** Writes the value and reports the outcome. */
    onset: (control: Control, value: number) => Promise<Outcome>;
  } = $props();

  let pending = $state<number | null>(null);
  let problem = $state.raw<Exclude<Outcome, { kind: "confirmed" }>>();

  const checked = $derived((pending ?? value) === 1);

  async function change(on: boolean): Promise<void> {
    pending = on ? 1 : 0;
    problem = undefined;
    const outcome = await onset(control, pending);
    pending = null;

    if (outcome.kind !== "confirmed") problem = outcome;
  }
</script>

<div class="flex flex-col gap-2 border-b border-border/60 pb-2">
  <Item.Root class="rounded-none border-0">
    {#snippet child({ props })}
      <label
        {...props}
        class={[
          props.class,
          control.writable ? "cursor-pointer hover:bg-muted/60" : "cursor-default",
        ]}
      >
        <Item.Content>
          <Item.Title class="text-[15px] font-normal">{label}</Item.Title>
          {#if control.awaiting}<Item.Description>{m.controls_needs_enable()}</Item.Description
            >{/if}
        </Item.Content>
        <Item.Actions>
          <Checkbox
            aria-label={label}
            {checked}
            disabled={!control.writable || pending !== null}
            onCheckedChange={(next) => void change(next)}
          />
        </Item.Actions>
      </label>
    {/snippet}
  </Item.Root>
  {#if problem}<div class="px-4"><WriteProblem {problem} /></div>{/if}
</div>
