<!-- A viewer or token under Settings › Users & access; nothing brings it back, so removing asks first. -->
<script lang="ts">
  import Trash2 from "@lucide/svelte/icons/trash-2";
  import type { Problem } from "../api/core";
  import ConfirmSheet from "../components/confirm-sheet.svelte";
  import { Button } from "@sunreye/ui/button";
  import * as Item from "@sunreye/ui/item";

  let {
    name,
    detail,
    ask,
    note,
    confirm,
    done,
    onremove,
  }: {
    name: string;
    detail?: string;
    /** The remove button's label, and the confirm's title. */
    ask: string;
    /** What removing does. */
    note: string;
    confirm: string;
    /** The toast once it is gone. */
    done: string;
    onremove: () => Promise<Problem | undefined>;
  } = $props();

  let asking = $state(false);
</script>

<Item.Root class="rounded-none border-0" role="listitem">
  <Item.Content>
    <Item.Title class="text-[15px] font-normal">{name}</Item.Title>
    {#if detail !== undefined}
      <Item.Description>{detail}</Item.Description>
    {/if}
  </Item.Content>
  <Item.Actions>
    <Button variant="ghost" size="icon-sm" aria-label={ask} onclick={() => (asking = true)}>
      <Trash2 class="text-muted-foreground" />
    </Button>
  </Item.Actions>
</Item.Root>
<ConfirmSheet bind:open={asking} title={ask} {note} action={confirm} {done} onconfirm={onremove} />
