<script lang="ts">
  import type { Core } from "../api/core";
  import { problemText } from "../i18n/problems";
  import { m } from "../paraglide/messages.js";
  import { getLocale } from "../paraglide/runtime.js";
  import { euros } from "./format";

  let { core }: { core: Core } = $props();

  /** The last 31 days, so a month shows whole. */
  const SPAN_MS = 31 * 86_400_000;

  const to = new Date();
  const costs = $derived(core.costs(new Date(to.getTime() - SPAN_MS), to));

  const date = new Intl.DateTimeFormat(getLocale(), {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });

  /** A plant-local day by its middle, which falls on its date in any viewer's timezone. */
  function day(start: string, end: string): string {
    return date.format((Date.parse(start) + Date.parse(end)) / 2);
  }
</script>

<section>
  <h2>{m.tariff_costs()}</h2>
  {#await costs then answer}
    {#if "problem" in answer}
      <p role="alert">{problemText(answer.problem)}</p>
    {:else}
      <table>
        <thead>
          <tr>
            <th scope="col">{m.tariff_day()}</th>
            <th scope="col">{m.tariff_paid()}</th>
            <th scope="col">{m.tariff_earned()}</th>
            <th scope="col">{m.tariff_saved()}</th>
          </tr>
        </thead>
        <tbody>
          {#each answer.days as row (row.start)}
            <tr>
              <th scope="row">{day(row.start, row.end)}</th>
              <td>{euros(row.paid)}</td>
              <td>{euros(row.earned)}</td>
              <td>{euros(row.saved)}</td>
            </tr>
          {/each}
        </tbody>
        <tfoot>
          <tr>
            <th scope="row">{m.tariff_total()}</th>
            <td>{euros(answer.total.paid)}</td>
            <td>{euros(answer.total.earned)}</td>
            <td>{euros(answer.total.saved)}</td>
          </tr>
        </tfoot>
      </table>
    {/if}
  {/await}
</section>

<style>
  td {
    font-variant-numeric: tabular-nums;
    text-align: end;
  }
</style>
