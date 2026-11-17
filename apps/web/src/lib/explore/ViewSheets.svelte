<!-- What the admin's menu asks before it writes (ADR 22): a name, or a yes to replacing or deleting. -->
<script lang="ts">
  import ConfirmSheet from "../components/confirm-sheet.svelte";
  import { m } from "../paraglide/messages.js";
  import { nameFor } from "./saved.ts";
  import type { ViewActions } from "./view-actions.svelte.ts";
  import ViewNameSheet from "./ViewNameSheet.svelte";

  let {
    actions,
    labels,
    changed,
  }: {
    actions: ViewActions;
    /** The chosen series' labels, which name a new view. */
    labels: readonly string[];
    /** Whether an open view was changed: the new view is saved beside it. */
    changed: boolean;
  } = $props();
</script>

<ViewNameSheet
  bind:open={actions.naming}
  title={changed ? m.explore_view_save_new() : m.explore_view_save()}
  name={nameFor(labels)}
  onsubmit={actions.add}
/>
<ViewNameSheet
  bind:open={() => actions.renaming !== undefined, () => (actions.renaming = undefined)}
  title={m.explore_view_rename_title()}
  name={actions.renaming?.name ?? ""}
  onsubmit={actions.rename}
/>
<ConfirmSheet
  bind:open={() => actions.replacing !== undefined, () => (actions.replacing = undefined)}
  title={m.explore_view_replace_title({ name: actions.replacing?.name ?? "" })}
  note={m.explore_view_replace_note()}
  action={m.explore_view_replace()}
  done={m.explore_view_saved()}
  onconfirm={actions.replace}
/>
<ConfirmSheet
  bind:open={() => actions.deleting !== undefined, () => (actions.deleting = undefined)}
  title={m.explore_view_delete_title({ name: actions.deleting?.name ?? "" })}
  note={m.explore_view_delete_note()}
  action={m.explore_view_delete()}
  done={m.explore_view_deleted()}
  onconfirm={actions.remove}
/>
