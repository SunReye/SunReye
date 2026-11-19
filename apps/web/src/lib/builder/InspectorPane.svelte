<!-- The inspector beside the canvas, or pulled up over it as a sheet (ADR 20). -->
<script lang="ts" module>
  export { PEEK } from "./InspectorSheet.svelte";
</script>

<script lang="ts">
  import GlassCard from "../components/glass-card.svelte";
  import type { Core, Device } from "../api/core.ts";
  import { m } from "../paraglide/messages.js";
  import Inspector from "./Inspector.svelte";
  import InspectorSheet from "./InspectorSheet.svelte";
  import ModelCheck from "./ModelCheck.svelte";
  import SelectionBar from "./SelectionBar.svelte";
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

  const selecting = $derived(session.wiring.selection.length > 0);
</script>

{#if sheet}
  <InspectorSheet bind:expanded={session.expanded} bar={selecting ? bar : undefined}>
    <Inspector {session} {check} />
  </InspectorSheet>
{:else}
  <GlassCard element="aside" aria-label={m.builder_edit()} class="flex min-h-0 flex-col">
    {#if selecting}
      {@render bar()}
    {/if}
    <div class="min-h-0 flex-1">
      <Inspector {session} {check} />
    </div>
  </GlassCard>
{/if}

<!-- In the sheet's peek on a phone, so the roof stays in view while its modules are picked. -->
{#snippet bar()}
  <SelectionBar wiring={session.wiring} strings={session.draft.strings} />
{/snippet}

<!-- Beside the strings it judges, at the slider's month and hour (ADR 20). -->
{#snippet check()}
  <ModelCheck {core} {devices} month={local.getMonth() + 1} hour={local.getHours()} />
{/snippet}
