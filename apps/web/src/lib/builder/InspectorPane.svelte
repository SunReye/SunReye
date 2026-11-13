<!-- The inspector beside the canvas, or pulled up over it as a sheet (ADR 20). -->
<script lang="ts" module>
  export { PEEK } from "./InspectorSheet.svelte";
</script>

<script lang="ts">
  import type { Core, Device } from "../api/core.ts";
  import { m } from "../paraglide/messages.js";
  import Inspector from "./Inspector.svelte";
  import InspectorSheet from "./InspectorSheet.svelte";
  import ModelCheck from "./ModelCheck.svelte";
  import type { Session } from "./session.svelte.ts";

  let {
    session,
    sheet,
    core,
    devices,
    at,
  }: {
    session: Session;
    sheet: boolean;
    core: Pick<Core, "corrections">;
    /** Names the inverters. */
    devices: readonly Device[];
    /** The time slider's instant, in milliseconds since 1970. */
    at: number;
  } = $props();

  const local = $derived(new Date(at));
</script>

{#if sheet}
  <InspectorSheet bind:expanded={session.expanded}>
    <Inspector {session} {check} />
  </InspectorSheet>
{:else}
  <aside
    aria-label={m.builder_edit()}
    class="glass-ambient min-h-0 overflow-hidden rounded-lg border border-border/60 elevation-1"
  >
    <Inspector {session} {check} />
  </aside>
{/if}

<!-- Beside the strings it judges, at the slider's month and hour (ADR 20). -->
{#snippet check()}
  <ModelCheck {core} {devices} month={local.getMonth() + 1} hour={local.getHours()} />
{/snippet}
