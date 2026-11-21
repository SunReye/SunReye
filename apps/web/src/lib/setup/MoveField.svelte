<!-- "Verschieben nach …": every point the open one may hang under, indented as in the tree. -->
<script lang="ts">
  import type { PointDraft } from "../api/core.ts";
  import SelectField from "../components/select-field.svelte";
  import type { Choice } from "../components/select/choices.ts";
  import { m } from "../paraglide/messages.js";
  import { roleOf } from "./point-look.ts";
  import PointTile from "./PointTile.svelte";
  import { depths, targets } from "./topology.ts";

  let {
    points,
    index,
    onmove,
  }: { points: readonly PointDraft[]; index: number; onmove: (parent: number) => void } = $props();

  const depth = $derived(depths(points));

  const options = $derived(
    targets(points, index).flatMap((at) => {
      const point = points[at];

      return point === undefined ? [] : [{ value: String(at), label: point.name }];
    }),
  );
</script>

{#snippet item({ value, label }: Choice)}
  {@const at = Number(value)}
  {@const point = points[at]}
  <span
    class="flex min-w-0 items-center gap-3"
    style:padding-left="{Math.min(depth[at] ?? 0, 4) * 16}px"
  >
    {#if point}<PointTile role={roleOf(point)} active={false} />{/if}
    <span class="truncate">{label}</span>
  </span>
{/snippet}

<SelectField
  field
  label={m.topology_move()}
  value={String(points[index]?.parent ?? "")}
  {options}
  {item}
  onchange={(at) => {
    onmove(Number(at));
  }}
/>
