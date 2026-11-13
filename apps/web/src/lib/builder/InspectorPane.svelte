<!-- The inspector beside the canvas, or pulled up over it as a sheet (ADR 20). -->
<script lang="ts">
  import type { ModuleType } from "../api/core.ts";
  import { m } from "../paraglide/messages.js";
  import Inspector from "./Inspector.svelte";
  import InspectorSheet from "./InspectorSheet.svelte";
  import type { Session } from "./session.svelte.ts";

  let {
    session,
    moduleTypes,
    sheet,
  }: { session: Session; moduleTypes: readonly ModuleType[]; sheet: boolean } = $props();
</script>

{#if sheet}
  <InspectorSheet bind:expanded={session.expanded}>
    <Inspector {session} {moduleTypes} />
  </InspectorSheet>
{:else}
  <aside
    aria-label={m.builder_edit()}
    class="glass-ambient min-h-0 overflow-hidden rounded-lg border border-border/60 elevation-1"
  >
    <Inspector {session} {moduleTypes} />
  </aside>
{/if}
