<!-- A viewer or token under Settings › Users & access; nothing brings it back, so removing asks first. -->
<script lang="ts">
  import Trash2 from "@lucide/svelte/icons/trash-2";
  import type { Problem } from "../api/core";
  import { Button } from "#lib/components/ui/button/index.js";
  import * as Item from "#lib/components/ui/item/index.js";
  import { problemText } from "../i18n/problems";
  import { m } from "../paraglide/messages.js";

  let {
    name,
    detail,
    ask,
    note,
    confirm,
    onremove,
  }: {
    name: string;
    detail?: string;
    /** The remove button's label. */
    ask: string;
    /** What removing does, shown while it waits for the confirm. */
    note: string;
    confirm: string;
    onremove: () => Promise<Problem | undefined>;
  } = $props();

  let asking = $state(false);
  let problem = $state.raw<Problem>();

  async function remove(): Promise<void> {
    problem = await onremove();
    asking = false;
  }
</script>

<Item.Root class="rounded-none border-0" role="listitem">
  <Item.Content>
    <Item.Title class="text-[15px] font-normal">{name}</Item.Title>
    {#if asking}
      <Item.Description>{note}</Item.Description>
    {:else if detail !== undefined}
      <Item.Description>{detail}</Item.Description>
    {/if}
    {#if problem}<p role="alert" class="text-sm">{problemText(problem.problem)}</p>{/if}
  </Item.Content>
  <Item.Actions>
    {#if asking}
      <Button variant="ghost" size="sm" onclick={() => (asking = false)}>{m.access_cancel()}</Button
      >
      <Button variant="destructive" size="sm" onclick={remove}>{confirm}</Button>
    {:else}
      <Button variant="ghost" size="icon-sm" aria-label={ask} onclick={() => (asking = true)}>
        <Trash2 class="text-muted-foreground" />
      </Button>
    {/if}
  </Item.Actions>
</Item.Root>
