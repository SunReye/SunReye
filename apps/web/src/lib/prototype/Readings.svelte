<!--
  PROTOTYPE: a node's readings in its detail sheet: what the device reads now, beyond the sheet's
  own figure and graph (v3's node dialog, on v5's roles; `readings.ts` decides what is listed).
  A calm list: groups under quiet titles, values prominent, labels quiet, tabular figures. Indexed
  readings (MPPT inputs, phases) are compared, so they sit in a table with the unit in its head.
  A silent device or a stalled stream says so once, above the list; a single stale reading shows
  its own age. Estimates carry "≈" (ADR 17, ADR 20).
-->
<script lang="ts">
  import TriangleAlert from "@lucide/svelte/icons/triangle-alert";
  import ChevronRight from "@lucide/svelte/icons/chevron-right";
  import AnimatedNumber from "./AnimatedNumber.svelte";
  import { ago, nodeReadings, type Row } from "./readings";
  import type { LiveSim } from "./sim.svelte";

  let { id, sim, onopen }: { id: string; sim: LiveSim; onopen: (id: string) => void } = $props();

  const node = $derived(nodeReadings(id, sim));
  const loading = $derived(sim.status === "loading");
  /** Why nothing here is current, when nothing is. */
  const silence = $derived.by(() => {
    if (!node || loading) return null;
    if (node.silent !== null) return `Gerät antwortet nicht · letzte Werte ${ago(node.silent)}`;
    if (sim.status !== "live") return `Angehalten · letzte Werte ${ago(sim.age)}`;
    return null;
  });
</script>

{#snippet figure(row: Row)}
  <span class={["whitespace-nowrap", (silence || row.age !== undefined) && "opacity-60"]}>
    {#if row.text !== undefined}
      <span class="font-semibold">{loading ? "–" : row.text}</span>
    {:else}
      {#if row.est}<span class="me-1 font-normal text-muted-foreground" title="geschätzt" aria-label="geschätzt">≈</span>{/if}<span class="font-semibold"
        ><AnimatedNumber value={loading ? null : (row.value ?? null)} digits={row.digits} appear={false} /></span
      >{#if row.unit}<span class="ms-1 text-muted-foreground">{row.unit}</span>{/if}
    {/if}
  </span>
{/snippet}

{#snippet label(row: Row)}
  <!-- Two lines before an ellipsis: a long name differs from its neighbour's at its end. -->
  <span class="line-clamp-2 min-w-0 break-words text-muted-foreground">{row.label}</span>
  {#if row.age !== undefined && !silence}
    <span class="shrink-0 text-xs text-warning">{ago(row.age)}</span>
  {/if}
{/snippet}

{#if node && node.groups.length > 0}
  <section class="flex flex-col gap-4 px-5 pt-4 pb-4 sm:px-6" aria-label="Messwerte">
    <header class="flex flex-col gap-0.5">
      <h3 class="text-sm font-semibold">Messwerte</h3>
      <p class="line-clamp-2 text-xs break-words text-muted-foreground">{node.device}</p>
      {#if silence}
        <p class="mt-1 flex items-center gap-1.5 text-xs font-medium text-warning" role="status"><TriangleAlert class="size-3.5 shrink-0" />{silence}</p>
      {/if}
    </header>

    {#each node.groups as group (group.title)}
      <div class="flex flex-col">
        <h4 class="pb-1 text-xs font-medium text-muted-foreground">{group.title}</h4>
        {#if group.note}
          <p class="pb-1.5 text-xs leading-snug text-muted-foreground">{group.note}</p>
        {/if}

        {#if group.rows.length > 0}
          <dl class="flex flex-col divide-y divide-border/50 border-t border-border/50 text-sm">
            {#each group.rows as row (row.key)}
              {#if row.to}
                <!-- A reading that is a node of its own opens that node's sheet. -->
                <button
                  type="button"
                  class="group -mx-2 flex items-baseline gap-2 rounded-sm px-2 py-2 text-left outline-none hover:bg-foreground/[0.04] focus-visible:ring-2 focus-visible:ring-ring"
                  onclick={() => onopen(row.to!)}
                >
                  <dt class="flex min-w-0 flex-1 items-baseline gap-2">{@render label(row)}</dt>
                  <dd class="flex items-baseline gap-1">{@render figure(row)}<ChevronRight class="size-3.5 shrink-0 self-center text-muted-foreground transition-transform group-hover:translate-x-0.5" /></dd>
                </button>
              {:else}
                <div class="flex items-baseline gap-2 py-2">
                  <dt class="flex min-w-0 flex-1 items-baseline gap-2">{@render label(row)}</dt>
                  <dd>{@render figure(row)}</dd>
                </div>
              {/if}
            {/each}
          </dl>
        {/if}

        {#if group.table}
          <table class="w-full border-t border-border/50 text-sm tabular-nums">
            <thead>
              <tr class="text-xs text-muted-foreground">
                <td></td>
                {#each group.table.cols as col (col.label)}
                  <th scope="col" class="py-1.5 pl-3 text-right font-normal">{col.label} <span class="opacity-70">{col.unit}</span></th>
                {/each}
              </tr>
            </thead>
            <tbody class="divide-y divide-border/50 border-t border-border/50">
              {#each group.table.rows as line (line.key)}
                <tr>
                  <th scope="row" class="py-2 text-left font-normal whitespace-nowrap text-muted-foreground">{line.label}</th>
                  {#each line.cells as cell, i (i)}
                    <td class={["py-2 pl-3 text-right font-semibold", (silence || cell?.age !== undefined) && "opacity-60"]} title={cell?.age !== undefined && !silence ? ago(cell.age) : undefined}>
                      {#if cell}<AnimatedNumber value={loading ? null : (cell.value ?? null)} digits={cell.digits} appear={false} />{:else}<span class="font-normal text-muted-foreground">–</span>{/if}
                    </td>
                  {/each}
                </tr>
              {/each}
            </tbody>
          </table>
        {/if}
      </div>
    {/each}
  </section>
{/if}
