<!--
  A node's readings in its detail sheet (ADR 21): what the device reads now, beyond the sheet's own
  figure and graph; `readings.ts` decides what is listed. Groups under quiet titles, values
  prominent, tabular figures. A silent device or a stopped stream says so once, above the list; a
  single stale reading shows its own age. Estimates carry "≈" (ADR 17, 20).
-->
<script lang="ts">
  import TriangleAlert from "@lucide/svelte/icons/triangle-alert";
  import { m } from "../paraglide/messages.js";
  import ReadingGroup from "./ReadingGroup.svelte";
  import { ago, type NodeReadings } from "./readings.ts";

  let {
    node,
    status,
    onopen,
  }: {
    node: NodeReadings | null;
    status: "loading" | "live" | "stopped";
    onopen: (id: string) => void;
  } = $props();

  const loading = $derived(status === "loading");

  /** Why nothing here is current, when nothing is. */
  const silence = $derived.by(() => {
    if (!node || loading) return null;

    if (node.silent !== null) return m.detail_silent({ age: ago(node.silent) });

    return status === "stopped" ? m.detail_stopped() : null;
  });

  const silent = $derived(silence !== null);
</script>

{#if node && node.groups.length > 0}
  <section
    class="flex flex-col gap-4 border-t border-border/60 px-5 pt-4 pb-4 sm:px-6"
    aria-label={m.detail_readings()}
  >
    <header class="flex flex-col gap-0.5">
      <h3 class="text-sm font-semibold">{m.detail_readings()}</h3>
      {#if node.device}
        <p class="line-clamp-2 text-xs break-words text-muted-foreground">{node.device}</p>
      {/if}
      {#if silence}
        <p class="mt-1 flex items-center gap-1.5 text-xs font-medium text-warning" role="status">
          <TriangleAlert class="size-3.5 shrink-0" />{silence}
        </p>
      {/if}
    </header>

    {#each node.groups as group (group.title)}
      <ReadingGroup {group} {loading} {silent} {onopen} />
    {/each}
  </section>
{/if}
