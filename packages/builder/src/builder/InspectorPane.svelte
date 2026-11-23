<!-- The inspector beside the canvas, or pulled up over it as a sheet (ADR 20); it takes the
  builder's editing keys. -->
<script lang="ts" module>
  export { PEEK } from "./InspectorSheet.svelte";
</script>

<script lang="ts">
  import * as Card from "@sunreye/ui/card";
  import type { Device, Records } from "./host.ts";
  import { m } from "../paraglide/messages.js";
  import Inspector from "./Inspector.svelte";
  import InspectorSheet from "./InspectorSheet.svelte";
  import ModelCheck from "./ModelCheck.svelte";
  import { OpeningClipboard } from "./opening-clipboard.ts";
  import type { Session } from "./session.svelte.ts";

  let {
    session,
    sheet,
    records,
    devices,
    at,
  }: {
    session: Session;
    sheet: boolean;
    records: Pick<Records, "corrections">;
    /** Names the inverters. */
    devices: readonly Device[];
    /** The time slider's instant, in milliseconds since 1970. */
    at: number;
  } = $props();

  const local = $derived(new Date(at));

  /** The editing keys, taken wherever the focus is: the inspector is always there. */
  const clipboard = new OpeningClipboard();
</script>

<svelte:window
  onkeydown={(event) => {
    clipboard.key(event, session);
  }}
/>

{#if sheet}
  <InspectorSheet bind:expanded={session.expanded}>
    <Inspector {session} {check} />
  </InspectorSheet>
{:else}
  <Card.Root element="aside" aria-label={m.builder_edit()} class="min-h-0 gap-0 py-0">
    <Inspector {session} {check} />
  </Card.Root>
{/if}

<!-- Beside the strings it judges, at the slider's month and hour (ADR 20). -->
{#snippet check()}
  <ModelCheck {records} {devices} month={local.getMonth() + 1} hour={local.getHours()} />
{/snippet}
