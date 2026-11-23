<!-- A ground surface's level in the inspector: its footprint and its finish. -->
<script lang="ts">
  import * as Item from "@sunreye/ui/item";
  import { m } from "../paraglide/messages.js";
  import { choices, degrees, metres, REACH } from "./fields.ts";
  import { GROUND_FINISHES } from "./outline.ts";
  import type { GroundSurface } from "./pv.ts";
  import RemoveButton from "./RemoveButton.svelte";
  import ValueRow from "./ValueRow.svelte";

  let {
    item,
    onchange,
    onremove,
  }: {
    item: GroundSurface;
    onchange: (item: GroundSurface) => void;
    onremove: () => void;
  } = $props();

  const fields = [
    ["x", metres(m.field_x(), -REACH, REACH)],
    ["z", metres(m.field_z(), -REACH, REACH)],
    ["width", metres(m.field_width(), 0.1, 100)],
    ["depth", metres(m.field_depth(), 0.1, 100)],
    ["rotation", degrees(m.field_rotation(), 0, 359)],
  ] as const satisfies readonly (readonly [Exclude<keyof GroundSurface, "finish">, unknown])[];

  const finish = choices(
    m.field_ground_finish(),
    GROUND_FINISHES.map(([, label]) => label()),
  );
</script>

<Item.Group class="gap-0 divide-y divide-border/60">
  <ValueRow
    edit={finish}
    value={GROUND_FINISHES.findIndex(([kind]) => kind === item.finish)}
    onchange={(index) => {
      const kind = GROUND_FINISHES[index]?.[0];

      if (kind !== undefined) onchange({ ...item, finish: kind });
    }}
  />
  {#each fields as [key, edit] (key)}
    <ValueRow
      {edit}
      value={item[key]}
      onchange={(value) => {
        onchange({ ...item, [key]: value });
      }}
    />
  {/each}
</Item.Group>
<RemoveButton {onremove} />
