<!-- A fence's level in the inspector: its finish, its height and each of its points. -->
<script lang="ts">
  import Plus from "@lucide/svelte/icons/plus";
  import { Button } from "@sunreye/ui/button";
  import * as Item from "@sunreye/ui/item";
  import { m } from "../paraglide/messages.js";
  import { lengthened, shortened } from "./draft.ts";
  import { choices, metres, REACH } from "./fields.ts";
  import { FENCE_FINISHES } from "./outline.ts";
  import type { Fence } from "./pv.ts";
  import RemoveButton from "./RemoveButton.svelte";
  import ValueRow from "./ValueRow.svelte";

  let {
    item,
    onchange,
    onremove,
  }: {
    item: Fence;
    onchange: (item: Fence) => void;
    onremove: () => void;
  } = $props();

  const finish = choices(
    m.field_fence_finish(),
    FENCE_FINISHES.map(([, label]) => label()),
  );

  const height = metres(m.field_height(), 0.1, 5);

  /** The fence with one point's x or z moved to `value`. */
  function moved(index: number, axis: "x" | "z", value: number): Fence {
    const point = item.points[index] ?? { x: 0, z: 0 };

    return { ...item, points: item.points.with(index, { ...point, [axis]: value }) };
  }
</script>

<Item.Group class="gap-0 divide-y divide-border/60">
  <ValueRow
    edit={finish}
    value={FENCE_FINISHES.findIndex(([kind]) => kind === item.finish)}
    onchange={(index) => {
      const kind = FENCE_FINISHES[index]?.[0];

      if (kind !== undefined) onchange({ ...item, finish: kind });
    }}
  />
  <ValueRow
    edit={height}
    value={item.height}
    onchange={(value) => {
      onchange({ ...item, height: value });
    }}
  />
  {#each item.points as { x, z }, index (index)}
    <ValueRow
      edit={metres(m.field_point_x({ number: index + 1 }), -REACH, REACH)}
      value={x}
      onchange={(value) => {
        onchange(moved(index, "x", value));
      }}
    />
    <ValueRow
      edit={metres(m.field_point_z({ number: index + 1 }), -REACH, REACH)}
      value={z}
      onchange={(value) => {
        onchange(moved(index, "z", value));
      }}
    />
  {/each}
</Item.Group>
<div class="flex flex-col gap-2 border-t border-border/60 p-3">
  <Button
    variant="outline"
    class="justify-start"
    onclick={() => {
      onchange(lengthened(item));
    }}
  >
    <Plus data-icon="inline-start" />
    {m.fence_add_point()}
  </Button>
  {#if item.points.length > 2}
    <Button
      variant="ghost"
      class="justify-start"
      onclick={() => {
        onchange(shortened(item));
      }}
    >
      {m.fence_remove_point()}
    </Button>
  {/if}
</div>
<RemoveButton {onremove} />
