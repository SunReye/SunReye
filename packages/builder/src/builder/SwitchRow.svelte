<!-- An inspector row that turns a yes-or-no part of the scene on or off. -->
<script lang="ts">
  import { Checkbox } from "@sunreye/ui/checkbox";
  import * as Item from "@sunreye/ui/item";
  import { FEEDBACK } from "@sunreye/ui/pressable";

  let {
    label,
    hint,
    checked,
    disabled = false,
    onchange,
  }: {
    label: string;
    /** What the switch does, or why it is held off; under the label. */
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
      class={[props.class, disabled ? "cursor-default" : ["cursor-pointer", FEEDBACK]]}
    >
      <Item.Content>
        <Item.Title class="text-[15px] font-normal">{label}</Item.Title>
        {#if hint}<Item.Description>{hint}</Item.Description>{/if}
      </Item.Content>
      <Item.Actions>
        <Checkbox {checked} {disabled} onCheckedChange={(next) => onchange(next)} />
      </Item.Actions>
    </label>
  {/snippet}
</Item.Root>
