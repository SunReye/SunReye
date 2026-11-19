<!-- The context toolbar for a selected object (ADR 20): its tools, or in the turn mode its angle
  and the way out. -->
<script lang="ts">
  import { turnAt } from "./context-actions.ts";
  import ObjectTools from "./ObjectTools.svelte";
  import type { Session } from "./session.svelte.ts";
  import TurnActions from "./TurnActions.svelte";

  let { session, onrefuse }: { session: Session; onrefuse: (reason?: string) => void } = $props();

  /** The object's turn, where it has a ring. */
  const angle = $derived(turnAt(session));
</script>

{#if angle !== undefined && session.stance.turning}
  <TurnActions
    {angle}
    ondone={() => {
      session.stance.turning = false;
    }}
  />
{:else}
  <ObjectTools {session} turnable={angle !== undefined} {onrefuse} />
{/if}
