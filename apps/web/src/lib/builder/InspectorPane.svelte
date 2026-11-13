<!-- The inspector beside the canvas, or pulled up over it as a sheet (ADR 20). -->
<script lang="ts">
  import { m } from "../paraglide/messages.js";
  import Inspector from "./Inspector.svelte";
  import InspectorSheet from "./InspectorSheet.svelte";
  import type { Session } from "./session.svelte.ts";

  let { session, sheet }: { session: Session; sheet: boolean } = $props();
</script>

{#if sheet}
  <InspectorSheet bind:expanded={session.expanded}>
    <Inspector {session} />
  </InspectorSheet>
{:else}
  <aside
    aria-label={m.builder_edit()}
    class="glass-ambient min-h-0 overflow-hidden rounded-lg border border-border/60 elevation-1"
  >
    <Inspector {session} />
  </aside>
{/if}
