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
      name: NAMES[id](),
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

  const ordered = $derived(
    sorted(rows, sort.column, sort.dir).map((row) => ({
      key: row.key,
      label: labelOf(row, period, zone),
      cells: figures.map((id) => ({ id, text: cell(row, id) })),
    })),
  );

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
  <Table.Body>
    {#each ordered as row (row.key)}
      <Table.Row>
        <th scope="row" class="px-2 py-2 text-left font-normal whitespace-nowrap">{row.label}</th>
        {#each row.cells as value (value.id)}
          <Table.Cell class="px-2 py-2 pr-7.5 text-right">{value.text}</Table.Cell>
        {/each}
      </Table.Row>
    {/each}
  </Table.Body>
</Table.Root>
