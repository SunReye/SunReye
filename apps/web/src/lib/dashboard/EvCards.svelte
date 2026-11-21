<!-- The loadpoints' cards: one appears when EVCC first names its loadpoint, and leaves with it (ADR 21). -->
<script lang="ts">
  import { Presence } from "#lib/components/ui/card/index.js";
  import type { FigureId } from "../detail/figures.ts";
  import EvCard from "./EvCard.svelte";

  let {
    loadpoints,
    names,
    onopen,
  }: {
    /** Each loadpoint's device and its live values by series name. */
    loadpoints: readonly { id: number; values: Readonly<Record<string, number>> }[];
    /** Device names, which only the admin may list (ADR 9). */
    names: ReadonlyMap<number, string>;
    onopen: (id: FigureId) => void;
  } = $props();
</script>

{#each loadpoints as loadpoint (loadpoint.id)}
  <Presence class="shrink-0">
    <EvCard device={loadpoint.id} name={names.get(loadpoint.id)} values={loadpoint.values} {onopen} />
  </Presence>
{/each}
