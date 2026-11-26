<!-- The headline's label. It stops claiming "now" the moment the stream does (ADR 21). -->
<script lang="ts">
  import StatusLine from "../components/status-line.svelte";
  import TriangleAlert from "@lucide/svelte/icons/triangle-alert";
  import Unplug from "@lucide/svelte/icons/unplug";
  import { problemText } from "../i18n/problems.ts";
  import { age } from "../live/stream.ts";
  import { m } from "../paraglide/messages.js";

  let {
    subject,
    staleSince,
    lost,
    refused,
    connecting,
  }: {
    subject: string;
    /** When the headline's series was last read, while it is stale. */
    staleSince: number | undefined;
    lost: boolean;
    /** The stream's refusal code. */
    refused: string | null;
    connecting: boolean;
  } = $props();
</script>

{#if staleSince !== undefined}
  <StatusLine tone="warning" icon={TriangleAlert}>
    {m.dash_lead_stalled({ subject, age: age(staleSince, Date.now()) })}
  </StatusLine>
{:else if lost}
  <StatusLine tone="destructive" icon={Unplug}>{m.dash_lead_offline({ subject })}</StatusLine>
{:else if refused !== null}
  <StatusLine tone="destructive" icon={Unplug}>
    {m.dash_lead_offline({ subject })} · {problemText(refused)}
  </StatusLine>
{:else if connecting}
  <StatusLine tone="muted" role="status">{m.dash_connecting()}</StatusLine>
{:else}
  <StatusLine tone="muted">{m.dash_lead_now({ subject })}</StatusLine>
{/if}
