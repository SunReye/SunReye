<!-- A price in ct/kWh as a settings row that opens the value editor (ADR 21); a price not yet entered says so. -->
<script lang="ts">
  import ValueRow from "../builder/ValueRow.svelte";

  let {
    name,
    price,
    onchange,
  }: { name: string; price: number | null; onchange: (price: number) => void } = $props();

  // A household price to the thousandth of a cent the core keeps (draft.ts).
  const edit = $derived({ kind: "number" as const, name, unit: "", min: 0, max: 200, step: 0.001 });
</script>

<ValueRow {edit} value={price ?? 0} missing={price === null} {onchange} />
