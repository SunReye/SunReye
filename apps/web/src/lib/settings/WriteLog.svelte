<script lang="ts">
  import type { Problem, WriteLog } from "../api/core";
  import { m } from "../paraglide/messages.js";
  import { getLocale } from "../paraglide/runtime.js";
  import { OUTCOMES } from "./outcomes";

  /** The core refuses the log without the admin's session; then nothing shows. */
  let { log }: { log: WriteLog | Problem } = $props();

  const number = new Intl.NumberFormat(getLocale());
  const time = new Intl.DateTimeFormat(getLocale(), { dateStyle: "short", timeStyle: "medium" });

  function value(of: number | null | undefined): string {
    return of === null || of === undefined ? "–" : number.format(of);
  }
</script>

{#if "writes" in log}
  {@render table(log)}
{/if}

{#snippet table(answer: WriteLog)}
  <table aria-label={m.writes_log()}>
    <caption>{m.writes_log()}</caption>
    <thead>
      <tr>
        <th>{m.log_time()}</th>
        <th>{m.log_device()}</th>
        <th>{m.log_setting()}</th>
        <th>{m.log_before()}</th>
        <th>{m.log_requested()}</th>
        <th>{m.log_after()}</th>
        <th>{m.log_outcome()}</th>
        <th>{m.log_step()}</th>
        <th>{m.log_actor()}</th>
      </tr>
    </thead>
    <tbody>
      <!-- Newest first; the log only grows, so a row's position is its key. -->
      {#each answer.writes.toReversed() as entry, row (answer.writes.length - row)}
        <tr>
          <td>{time.format(new Date(entry.time))}</td>
          <td>{entry.device}</td>
          <td>{entry.setting}</td>
          <td>{value(entry.before)}</td>
          <td>{value(entry.requested)}</td>
          <td>{value(entry.after)}</td>
          <td>{OUTCOMES[entry.outcome]()}</td>
          <td>{value(entry.failedStep)}</td>
          <td>{entry.actor}</td>
        </tr>
      {/each}
    </tbody>
  </table>
{/snippet}

<style>
  table {
    border-collapse: collapse;
    font-variant-numeric: tabular-nums;
  }

  caption {
    text-align: start;
    font-weight: bold;
  }

  th,
  td {
    padding: 0.25rem 0.5rem;
    text-align: start;
  }
</style>
