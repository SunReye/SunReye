<script lang="ts">
  import { getCoreRowModel, type ColumnDef } from "@tanstack/table-core";
  import { BarChart } from "layerchart";
  import * as Chart from "../../components/ui/chart/index.js";
  import { createSvelteTable, FlexRender } from "../../components/ui/data-table/index.js";
  import * as Table from "../../components/ui/table/index.js";
  import Demo from "../Demo.svelte";

  type Reading = { name: string; volts: number; amps: number };

  const READINGS: Reading[] = [
    { name: "MPPT 1", volts: 412.6, amps: 8.31 },
    { name: "MPPT 2", volts: 398.1, amps: 7.94 },
    { name: "Battery", volts: 51.2, amps: -12.4 },
  ];

  const columns: ColumnDef<Reading>[] = [
    { accessorKey: "name", header: "Input" },
    { accessorKey: "volts", header: "V" },
    { accessorKey: "amps", header: "A" },
  ];

  const table = createSvelteTable({
    data: READINGS,
    columns,
    getCoreRowModel: getCoreRowModel(),
  });

  const HOURS = [
    { hour: "09", solar: 1.2, house: 0.6 },
    { hour: "10", solar: 2.4, house: 0.7 },
    { hour: "11", solar: 3.6, house: 1.4 },
    { hour: "12", solar: 4.1, house: 0.9 },
    { hour: "13", solar: 3.8, house: 0.8 },
  ];

  const flows = {
    solar: { label: "Solar", color: "var(--e-solar)" },
    house: { label: "House", color: "var(--e-house)" },
  } satisfies Chart.ChartConfig;
</script>

<Demo name="table">
  <Table.Root class="w-80">
    <Table.Header>
      <Table.Row>
        <Table.Head>Input</Table.Head>
        <Table.Head class="text-right">V</Table.Head>
        <Table.Head class="text-right">A</Table.Head>
      </Table.Row>
    </Table.Header>
    <Table.Body>
      {#each READINGS as reading (reading.name)}
        <Table.Row>
          <Table.Cell>{reading.name}</Table.Cell>
          <Table.Cell class="text-right">{reading.volts.toFixed(1)}</Table.Cell>
          <Table.Cell class="text-right">{reading.amps.toFixed(2)}</Table.Cell>
        </Table.Row>
      {/each}
    </Table.Body>
  </Table.Root>
</Demo>

<Demo name="data-table">
  <Table.Root class="w-80">
    <Table.Header>
      {#each table.getHeaderGroups() as group (group.id)}
        <Table.Row>
          {#each group.headers as header (header.id)}
            <Table.Head>
              <FlexRender content={header.column.columnDef.header} context={header.getContext()} />
            </Table.Head>
          {/each}
        </Table.Row>
      {/each}
    </Table.Header>
    <Table.Body>
      {#each table.getRowModel().rows as row (row.id)}
        <Table.Row>
          {#each row.getVisibleCells() as cell (cell.id)}
            <Table.Cell>
              <FlexRender content={cell.column.columnDef.cell} context={cell.getContext()} />
            </Table.Cell>
          {/each}
        </Table.Row>
      {/each}
    </Table.Body>
  </Table.Root>
</Demo>

<Demo name="chart">
  <Chart.Container config={flows} class="h-44 w-96">
    <BarChart
      data={HOURS}
      x="hour"
      seriesLayout="group"
      props={{ bars: { radius: 2, strokeWidth: 0 } }}
      series={[
        { key: "solar", label: flows.solar.label, color: flows.solar.color },
        { key: "house", label: flows.house.label, color: flows.house.color },
      ]}
    >
      {#snippet tooltip()}
        <Chart.Tooltip />
      {/snippet}
    </BarChart>
  </Chart.Container>
</Demo>
