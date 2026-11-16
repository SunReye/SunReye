<!--
  The fold's table (ADR 22): a row per period with its mean, min, max, energy and hours with a
  value, or a counter's delta; a press on a column sorts by it, a second the other way.
-->
<script lang="ts">
  import * as Table from "#lib/components/ui/table/index.js";
  import type { Period } from "../api/core.ts";
  import { haptics } from "../haptics.ts";
  import { m } from "../paraglide/messages.js";
  import FoldHead from "./FoldHead.svelte";
  import {
    columnsOf,
    energyOf,
    figure,
    labelOf,
    sorted,
    type Column,
    type FoldRow,
  } from "./fold.ts";

  let {
    rows,
    period,
    counter,
    unit,
    zone,
  }: {
    rows: readonly FoldRow[];
    period: Period;
    counter: boolean;
    unit: string | null;
    zone: string;
  } = $props();

  const NAMES: Readonly<Record<Column, () => string>> = {
    period: m.explore_fold_period,
    mean: m.explore_fold_mean,
    min: m.explore_fold_min,
    max: m.explore_fold_max,
    energy: m.explore_fold_energy,
    delta: m.explore_fold_delta,
    hours: m.explore_fold_hours_valued,
  };

  const energy = $derived(energyOf(unit));

  const columns = $derived(
    columnsOf(counter, unit).map((id) => ({
      id,
      // A cost rate sums to money: its column is a sum, not energy.
      name: id === "energy" && energy?.energy === false ? m.explore_fold_sum() : NAMES[id](),
      unit: id === "period" ? null : id === "hours" ? "h" : id === "energy" ? energy?.unit : unit,
    })),
  );

  let chosen = $state<{ column: Column; dir: "asc" | "desc" }>({ column: "period", dir: "asc" });

  // Another series may have no such column: its table opens in time order.
  const sort = $derived(
    columns.some((c) => c.id === chosen.column)
      ? chosen
      : { column: "period" as const, dir: "asc" as const },
  );

  /** The figures' columns, after the period's. */
  const figures = $derived(columnsOf(counter, unit).filter((id) => id !== "period"));

  const cell = (row: FoldRow, column: Exclude<Column, "period">): string =>
    column === "energy" && row.energy !== null
      ? figure(row.energy / (energy?.per ?? 1))
      : figure(row[column]);

  const ordered = $derived(sorted(rows, sort.column, sort.dir));

  /** Rows mounted per frame: a fold by hours has hundreds, too many for one (ADR 21). */
  const BATCH = 40;

  /** How many rows of which order are mounted so far. */
  let grown = $state.raw<{ of: readonly FoldRow[]; count: number } | null>(null);

  const mounted = $derived(grown?.of === ordered ? grown.count : BATCH);

  const shown = $derived(
    ordered.slice(0, mounted).map((row) => ({
      key: row.key,
      label: labelOf(row, period, zone),
      cells: figures.map((id) => ({ id, text: cell(row, id) })),
    })),
  );

  /** Mounts a new order's rows a batch a frame, until all stand. */
  function grow(): () => void {
    const of = ordered;
    let count = BATCH;
    let frame = 0;

    const more = () => {
      if (count >= of.length) return;

      count += BATCH;
      grown = { of, count };
      frame = requestAnimationFrame(more);
    };

    frame = requestAnimationFrame(more);

    return () => {
      cancelAnimationFrame(frame);
    };
  }

  function press(column: Column): void {
    haptics.selection();

    if (sort.column === column) chosen = { column, dir: sort.dir === "asc" ? "desc" : "asc" };
    // Figures open on their largest, time on its earliest.
    else chosen = { column, dir: column === "period" ? "asc" : "desc" };
  }
</script>

<Table.Root aria-label={m.explore_fold_table()}>
  <Table.Header>
    <Table.Row class="hover:bg-transparent">
      {#each columns as column (column.id)}
        <FoldHead
          name={column.name}
          unit={column.unit ?? null}
          figure={column.id !== "period"}
          dir={sort.column === column.id ? sort.dir : null}
          onpress={() => {
            press(column.id);
          }}
        />
      {/each}
    </Table.Row>
  </Table.Header>
  <Table.Body {@attach grow}>
    {#each shown as row (row.key)}
      <!-- Plain rows: a fold by hours mounts hundreds, each a component too many (ADR 21). -->
      <tr class="border-b transition-colors hover:bg-muted/50">
        <th scope="row" class="px-2 py-2 text-left font-normal whitespace-nowrap">{row.label}</th>
        {#each row.cells as value (value.id)}
          <td class="px-2 py-2 pr-7.5 text-right align-middle whitespace-nowrap">{value.text}</td>
        {/each}
      </tr>
    {/each}
  </Table.Body>
</Table.Root>
