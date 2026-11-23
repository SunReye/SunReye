<!-- A marker's level in the inspector: its device, block, wall and place along it. -->
<script lang="ts">
  import * as Item from "@sunreye/ui/item";
  import type { Device } from "../api/core.ts";
  import { m } from "../paraglide/messages.js";
  import { choices, metres } from "./fields.ts";
  import type { Equipment, Wall } from "@sunreye/builder/builder/pv.ts";
  import RemoveButton from "./RemoveButton.svelte";
  import SwitchRow from "./SwitchRow.svelte";
  import ValueRow from "./ValueRow.svelte";

  let {
    marker,
    devices,
    blocks,
    onchange,
    onremove,
  }: {
    marker: Equipment;
    devices: readonly Device[];
    /** How many blocks the scene has. */
    blocks: number;
    onchange: (marker: Equipment) => void;
    onremove: () => void;
  } = $props();

  const WALLS: readonly (readonly [Wall, () => string])[] = [
    ["front", m.wall_front],
    ["right", m.wall_right],
    ["back", m.wall_back],
    ["left", m.wall_left],
  ];

  const device = $derived(
    choices(
      m.equipment_device(),
      devices.map(({ name }) => name),
    ),
  );

  const block = $derived(
    choices(
      m.equipment_block(),
      Array.from({ length: blocks }, (_, index) => m.builder_block({ number: index + 1 })),
    ),
  );

  const wall = choices(
    m.equipment_wall(),
    WALLS.map(([, label]) => label()),
  );

  const along = metres(m.equipment_along(), 0, 60);
</script>

<Item.Group class="gap-0 divide-y divide-border/60">
  <ValueRow
    edit={device}
    value={devices.findIndex(({ id }) => id === marker.device)}
    onchange={(index) => {
      const chosen = devices[index];

      if (chosen !== undefined) onchange({ ...marker, device: chosen.id });
    }}
  />
  <ValueRow
    edit={block}
    value={marker.block}
    onchange={(index) => {
      onchange({ ...marker, block: index });
    }}
  />
  <ValueRow
    edit={wall}
    value={WALLS.findIndex(([side]) => side === marker.wall)}
    onchange={(index) => {
      const side = WALLS[index]?.[0];

      if (side !== undefined) onchange({ ...marker, wall: side });
    }}
  />
  <ValueRow
    edit={along}
    value={marker.along}
    onchange={(value) => {
      onchange({ ...marker, along: value });
    }}
  />
  <SwitchRow
    label={m.equipment_inside()}
    checked={marker.inside}
    onchange={(inside) => {
      onchange({ ...marker, inside });
    }}
  />
</Item.Group>
<RemoveButton {onremove} />
