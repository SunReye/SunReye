<!-- "Verschieben nach …": every point the open one may hang under, indented as in the tree. -->
<script lang="ts">
  import Eyebrow from "../components/eyebrow.svelte";
  import type { PointDraft } from "../api/core.ts";
  import * as RadioGroup from "../components/ui/radio-group/index.js";
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

      return point === undefined ? [] : [{ at, name: point.name, role: roleOf(point) }];
    }),
  );
</script>

<fieldset class="flex flex-col gap-1">
  <Eyebrow element="legend" class="pb-2">{m.topology_move()}</Eyebrow>
  <RadioGroup.Root
    class="gap-1"
    aria-label={m.topology_move()}
    value={String(points[index]?.parent ?? "")}
    onValueChange={(at) => {
      onmove(Number(at));
    }}
  >
    {#each options as { at, name, role } (at)}
      <label
        class="flex min-h-12 cursor-pointer items-center gap-3 rounded-md px-2 hover:bg-foreground/[0.04] has-data-[state=checked]:bg-foreground/[0.06]"
        style:padding-left="{8 + Math.min(depth[at] ?? 0, 4) * 16}px"
      >
        <RadioGroup.Item value={String(at)} />
        <PointTile {role} active={false} />
        <span class="truncate text-[15px]">{name}</span>
      </label>
    {/each}
  </RadioGroup.Root>
</fieldset>
