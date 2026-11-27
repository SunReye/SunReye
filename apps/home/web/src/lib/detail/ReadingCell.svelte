<!--
  One cell of a readings table: the number, dimmed with its age as a title once stale. A reading
  with stored history opens Explore on its series (ADR 22).
-->
<script lang="ts">
  import * as Table from "../components/ui/table/index.js";
  import { m } from "../paraglide/messages.js";
  import { isPower } from "../power.ts";
  import Quantity from "./Quantity.svelte";
  import { ago } from "./readings.ts";
  import type { Row } from "./rows.ts";

  let {
    cell,
    line,
    loading,
    silent,
  }: {
    cell: Row | null;
    /** The line's label, which names the cell's link beside its column. */
    line: string;
    loading: boolean;
    silent: boolean;
  } = $props();

  const age = $derived(silent ? undefined : cell?.age);
  const value = $derived(loading ? null : (cell?.value ?? null));
</script>

{#snippet quantity(shown: Row)}
  <!-- The head carries every unit but a power's. -->
  <Quantity
    {value}
    unit={isPower(shown.unit) ? shown.unit : ""}
    digits={shown.digits}
    unitClass="font-normal text-muted-foreground"
  />
{/snippet}

<Table.Cell
  class={[
    "py-2 pr-0 pl-3 text-right font-semibold",
    (silent || cell?.age !== undefined) && "opacity-60",
  ]}
  title={age === undefined ? undefined : ago(age)}
>
  {#if cell?.href !== undefined}
    <a
      href={cell.href}
      aria-label={m.detail_explore({ label: `${line} · ${cell.label}` })}
      class="rounded-sm underline decoration-border underline-offset-4 outline-none hover:decoration-foreground focus-visible:ring-2 focus-visible:ring-ring"
    >
      {@render quantity(cell)}
    </a>
  {:else if cell}
    {@render quantity(cell)}
  {:else}
    <span class="font-normal text-muted-foreground">–</span>
  {/if}
</Table.Cell>
