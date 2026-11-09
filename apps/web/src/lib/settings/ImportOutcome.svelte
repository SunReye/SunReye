<script lang="ts">
  import type { ImportStatus } from "../api/core";
  import { problemText } from "../i18n/problems";
  import { m } from "../paraglide/messages.js";

  /** Where the import stands: its progress, its result, or why it failed. */
  let { status }: { status: ImportStatus } = $props();
</script>

{#if status.state === "running"}
  <progress aria-label={m.import_progress()} value={status.done} max={status.total}></progress>
  <p>{m.import_running({ done: status.done, total: status.total })}</p>
{:else if status.state === "done" && status.report}
  <p role="status">{m.import_done(status.report)}</p>
  {@render left(m.import_unread(), status.report.unread)}
  {@render left(m.import_unmapped(), status.report.unmapped)}
{:else if status.state === "failed" && status.problem}
  <p role="alert">{problemText(status.problem)}</p>
{/if}

{#snippet left(title: string, items: readonly string[])}
  {#if items.length > 0}
    <p>{title}</p>
    <ul>
      {#each items as item (item)}
        <li>{item}</li>
      {/each}
    </ul>
  {/if}
{/snippet}
