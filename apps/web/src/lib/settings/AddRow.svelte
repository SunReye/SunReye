<!-- The last row of a settings list: adds one more, in the list's own place rather than as a page-wide button. -->
<script lang="ts">
  import { Pressable } from "../components/ui/pressable/index.js";
  import Plus from "@lucide/svelte/icons/plus";
  import * as Item from "#lib/components/ui/item/index.js";

  let { label, onclick }: { label: string; onclick: () => void } = $props();
</script>

<Item.Root class="rounded-none border-0">
  {#snippet child({ props })}
    <Pressable
      feedback
      {...props}
      {onclick}
      class={[props.class, "flex-nowrap text-left text-brand "]}
    >
      <Item.Media class="size-5 text-brand"><Plus class="size-[18px]" /></Item.Media>
      <Item.Content class="min-w-0">
        <Item.Title class="text-[15px] font-normal text-brand">{label}</Item.Title>
      </Item.Content>
    </Pressable>
  {/snippet}
</Item.Root>
