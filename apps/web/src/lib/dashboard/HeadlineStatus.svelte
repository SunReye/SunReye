<!-- The headline's label. It stops claiming "now" the moment the stream does (ADR 21). -->
<script lang="ts">
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
  <span class="flex items-center gap-1.5 text-xs font-medium text-warning" role="status"
    ><TriangleAlert class="size-3.5 shrink-0" />{m.dash_lead_stalled({
      subject,
      age: age(staleSince, Date.now()),
    })}</span
  >
{:else if lost}
  <span class="flex items-center gap-1.5 text-xs font-medium text-destructive" role="alert"
    ><Unplug class="size-3.5 shrink-0" />{m.dash_lead_offline({ subject })}</span
  >
{:else if refused !== null}
  <span class="flex items-center gap-1.5 text-xs font-medium text-destructive" role="alert"
    ><Unplug class="size-3.5 shrink-0" />{m.dash_lead_offline({ subject })} · {problemText(
      refused,
    )}</span
  >
{:else if connecting}
  <span class="text-xs font-medium text-muted-foreground" role="status">{m.dash_connecting()}</span>
{:else}
  <span class="text-xs font-medium text-muted-foreground">{m.dash_lead_now({ subject })}</span>
{/if}
