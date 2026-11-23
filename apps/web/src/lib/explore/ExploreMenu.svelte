<!--
  The admin's menu in the header (ADR 22), where a viewer has the export alone: the export, and
  what can be done with the route as a saved view. Each asking opens beside the menu, never in it.
-->
<script lang="ts">
  import Ellipsis from "@lucide/svelte/icons/ellipsis";
  import { Button } from "@sunreye/ui/button";
  import * as DropdownMenu from "@sunreye/ui/dropdown-menu";
  import { m } from "../paraglide/messages.js";
  import type { Table } from "./csv.ts";
  import { save } from "./save.ts";
  import type { Saved } from "./saved.svelte.ts";
  import type { ViewActions } from "./view-actions.svelte.ts";

  let {
    table,
    saved,
    actions,
  }: {
    /** The open mode's plotted points; null while nothing is drawn. */
    table: Table | null;
    saved: Saved;
    actions: ViewActions;
  } = $props();
</script>

<DropdownMenu.Root>
  <DropdownMenu.Trigger>
    {#snippet child({ props })}
      <Button
        {...props}
        variant="outline"
        size="icon-sm"
        aria-label={m.explore_menu()}
        title={m.explore_menu()}
      >
        <Ellipsis />
      </Button>
    {/snippet}
  </DropdownMenu.Trigger>
  <DropdownMenu.Content align="end" class="min-w-56">
    <DropdownMenu.Item
      class="min-h-10"
      disabled={table === null}
      onSelect={() => {
        if (table) save(table);
      }}>{m.explore_export()}</DropdownMenu.Item
    >
    <DropdownMenu.Separator />
    {#if saved.marked}
      {@const view = saved.marked}
      <DropdownMenu.Item class="min-h-10" onSelect={() => (actions.renaming = view)}
        >{m.explore_view_rename()}</DropdownMenu.Item
      >
      <DropdownMenu.Item
        class="min-h-10"
        variant="destructive"
        onSelect={() => (actions.deleting = view)}>{m.explore_view_delete()}</DropdownMenu.Item
      >
    {:else if saved.changed}
      {@const view = saved.changed}
      <!-- Which view an update writes: its chip is no longer marked. -->
      <DropdownMenu.Label class="max-w-64 truncate text-xs font-normal text-muted-foreground"
        >{m.explore_view_open({ name: view.name })}</DropdownMenu.Label
      >
      <DropdownMenu.Item class="min-h-10" onSelect={() => void actions.update(view)}
        >{m.explore_view_update()}</DropdownMenu.Item
      >
      <DropdownMenu.Item class="min-h-10" onSelect={() => (actions.naming = true)}
        >{m.explore_view_save_new()}</DropdownMenu.Item
      >
    {:else}
      <DropdownMenu.Item class="min-h-10" onSelect={() => (actions.naming = true)}
        >{m.explore_view_save()}</DropdownMenu.Item
      >
    {/if}
  </DropdownMenu.Content>
</DropdownMenu.Root>
