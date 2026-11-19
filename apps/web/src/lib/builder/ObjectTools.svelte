<!-- A selected object's tools in the context toolbar (ADR 20): an opening carries its own; what
  has a ring is turned after "Drehen"; every object is edited in the inspector, pulled up at it,
  and removed. -->
<script lang="ts">
  import Pencil from "@lucide/svelte/icons/pencil";
  import RotateCw from "@lucide/svelte/icons/rotate-cw";
  import Trash2 from "@lucide/svelte/icons/trash-2";
  import { m } from "../paraglide/messages.js";
  import { removeAt } from "./context-actions.ts";
  import OpeningActions from "./OpeningActions.svelte";
  import type { Session } from "./session.svelte.ts";
  import WallAdds from "./WallAdds.svelte";
  import ToolButton from "./ToolButton.svelte";

  let {
    session,
    turnable,
    onrefuse,
  }: { session: Session; turnable: boolean; onrefuse: (reason?: string) => void } = $props();

  const opening = $derived(
    session.level.kind === "opening"
      ? session.draft.scene.openings?.[session.level.index]
      : undefined,
  );

  // A scene keeps at least one block.
  const removable = $derived(
    session.level.kind !== "block" || session.draft.scene.blocks.length > 1,
  );
</script>

{#if opening !== undefined}
  <OpeningActions {session} {opening} {onrefuse} />
{:else}
  {#if session.stance.spot !== undefined}
    <WallAdds {session} {onrefuse} />
  {/if}
  {#if turnable}
    <ToolButton
      icon={RotateCw}
      label={m.builder_turn()}
      onclick={() => {
        session.stance.turning = true;
      }}
    />
  {/if}
  <ToolButton
    icon={Pencil}
    label={m.builder_edit_object()}
    onclick={() => {
      session.expanded = true;
    }}
  />
{/if}
{#if removable}
  <ToolButton
    icon={Trash2}
    label={m.builder_remove()}
    onclick={() => {
      removeAt(session);
    }}
  />
{/if}
