<!--
  The header's one control beside the mode switch (ADR 22): the export for a viewer, and for the
  admin a menu that holds it with the saved views' actions. The row has room for one of them.
-->
<script lang="ts">
  import type { Table } from "./csv.ts";
  import ExploreMenu from "./ExploreMenu.svelte";
  import ExportButton from "./ExportButton.svelte";
  import type { Saved } from "./saved.svelte.ts";
  import { ViewActions } from "./view-actions.svelte.ts";
  import ViewSheets from "./ViewSheets.svelte";

  let {
    admin,
    table,
    saved,
    labels,
  }: {
    admin: boolean;
    /** The open mode's plotted points; null while nothing is drawn. */
    table: Table | null;
    saved: Saved;
    /** The chosen series' labels, which name a new view. */
    labels: readonly string[];
  } = $props();

  const actions = new ViewActions(() => saved);
</script>

{#if admin}
  <ExploreMenu {table} {saved} {actions} />
  <ViewSheets {actions} {labels} changed={saved.changed !== undefined} />
{:else}
  <ExportButton {table} />
{/if}
