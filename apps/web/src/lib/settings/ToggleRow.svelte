<!-- A settings row that turns one thing on or off: its name, a line of status or range, and a switch. -->
<script lang="ts">
  import * as Item from "#lib/components/ui/item/index.js";
  import { FEEDBACK } from "#lib/components/ui/pressable/index.js";
  import { Switch } from "#lib/components/ui/switch/index.js";

  let {
    label,
    name = label,
    hint,
    checked,
    disabled = false,
    onchange,
  }: {
    label: string;
    /** The switch's name for assistive tech, when the label alone leaves out what it switches. */
    name?: string;
    /** Under the label: a range, a status, or why the switch is held. */
    hint?: string | undefined;
    checked: boolean;
    disabled?: boolean;
    onchange: (checked: boolean) => void;
  } = $props();
</script>

<Item.Root class="rounded-none border-0">
  {#snippet child({ props })}
    <label
      {...props}
      class={[
        props.class,
        "flex-nowrap",
        disabled ? "cursor-default" : ["cursor-pointer", FEEDBACK],
      ]}
    >
      <Item.Content class="min-w-0">
        <Item.Title class="text-[15px] leading-snug font-normal text-wrap">{label}</Item.Title>
        {#if hint}<Item.Description class="tabular-nums">{hint}</Item.Description>{/if}
      </Item.Content>
      <Item.Actions>
        <Switch aria-label={name} {checked} {disabled} onCheckedChange={(next) => onchange(next)} />
      </Item.Actions>
    </label>
  {/snippet}
</Item.Root>
