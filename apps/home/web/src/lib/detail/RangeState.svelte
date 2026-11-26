<!--
  What a sheet's range holds before its tabs (ADR 21): a failed read with its retry, or the one
  sentence for a range before the record, in place of the tabs; else where the record begins or its
  readings stop, above them.
-->
<script lang="ts">
  import type { Snippet } from "svelte";
  import LoadFailed from "../components/load-failed.svelte";
  import { m } from "../paraglide/messages.js";
  import type { Problem } from "../api/client.ts";
  import type { HeadView } from "./head.svelte.ts";

  let {
    head = null,
    failed = false,
    refused,
    onretry,
    children,
  }: {
    /** The sheet's figure over the range; null where it heads with none. */
    head?: HeadView | null;
    /** The panel's own read of the range failed, though the head's did not. */
    failed?: boolean;
    /** Why the core refused the panel's own read. */
    refused?: Problem | undefined;
    onretry: () => void;
    children: Snippet;
  } = $props();
</script>

{#if failed || head?.state === "error"}
  <LoadFailed text={m.detail_error()} refused={head?.refused ?? refused} {onretry} />
{:else if head?.state === "before"}
  <p class="py-6 text-sm text-muted-foreground">{head.notes[0]}</p>
{:else}
  {#if head && head.notes.length > 0}
    <p class="text-xs text-muted-foreground">{head.notes.join(" · ")}</p>
  {/if}
  {@render children()}
{/if}
