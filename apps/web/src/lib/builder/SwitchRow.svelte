<!-- An inspector row that turns a yes-or-no part of the scene on or off. -->
<script lang="ts">
  import { Checkbox } from "#lib/components/ui/checkbox/index.js";
  import * as Item from "#lib/components/ui/item/index.js";

  let {
    label,
    checked,
    onchange,
  }: {
    label: string;
    checked: boolean;
    onchange: (checked: boolean) => void;
  } = $props();
</script>

<Item.Root class="rounded-none border-0">
  {#snippet child({ props })}
    <label {...props} class={[props.class, "cursor-pointer hover:bg-muted/60"]}>
      <Item.Content>
        <Item.Title class="text-[15px] font-normal">{label}</Item.Title>
      </Item.Content>
      <Item.Actions>
        <Checkbox {checked} onCheckedChange={(next) => onchange(next)} />
      </Item.Actions>
    </label>
  {/snippet}
</Item.Root>
