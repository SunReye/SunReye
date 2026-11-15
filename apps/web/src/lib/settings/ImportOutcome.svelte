<script lang="ts">
  import type { ImportStatus } from "../api/core";
  import { Progress } from "#lib/components/ui/progress/index.js";
  import { problemText } from "../i18n/problems";
  import { m } from "../paraglide/messages.js";
  import Refusal from "../setup/Refusal.svelte";

  /** Where the import stands: its progress, its result, or why it failed. */
  let { status }: { status: ImportStatus } = $props();
</script>

{#if status.state === "running"}
  <div class="flex flex-col gap-2">
    <Progress aria-label={m.import_progress()} value={status.done} max={status.total} />
    <p class="text-sm text-muted-foreground tabular-nums">
      {m.import_running({ done: status.done, total: status.total })}
    </p>
  </div>
{:else if status.state === "done" && status.report}
  <div class="flex flex-col gap-2 text-sm">
    <p role="status">{m.import_done(status.report)}</p>
    {@render left(m.import_unread(), status.report.unread)}
    {@render left(m.import_unmapped(), status.report.unmapped)}
  </div>
{:else if status.state === "failed" && status.problem}
  <Refusal text={problemText(status.problem)} />
{/if}

{#snippet left(title: string, items: readonly string[])}
  {#if items.length > 0}
    <p class="text-muted-foreground">{title}</p>
    <ul class="flex flex-col gap-0.5 font-mono text-xs">
      {#each items as item (item)}
        <li>{item}</li>
      {/each}
    </ul>
  {/if}
{/snippet}
