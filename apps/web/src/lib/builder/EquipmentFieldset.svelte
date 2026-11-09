<script lang="ts">
  import type { Device } from "../api/core.ts";
  import { m } from "../paraglide/messages.js";
  import NumberField from "./NumberField.svelte";
  import type { Equipment, Wall } from "./pv.ts";

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

  const kinds: Readonly<Record<Equipment["kind"], () => string>> = {
    inverter: m.equipment_inverter,
    battery: m.equipment_battery,
  };

  const walls: readonly (readonly [Wall, () => string])[] = [
    ["front", m.wall_front],
    ["right", m.wall_right],
    ["back", m.wall_back],
    ["left", m.wall_left],
  ];

  const numbers = $derived(Array.from({ length: blocks }, (_, index) => index));
</script>

<fieldset>
  <legend>{kinds[marker.kind]()}</legend>
  <label>
    {m.equipment_device()}
    <select
      value={marker.device}
      onchange={(event) => {
        onchange({ ...marker, device: Number(event.currentTarget.value) });
      }}
    >
      {#each devices as device (device.id)}
        <option value={device.id}>{device.name}</option>
      {/each}
    </select>
  </label>
  <label>
    {m.equipment_block()}
    <select
      value={marker.block}
      onchange={(event) => {
        onchange({ ...marker, block: Number(event.currentTarget.value) });
      }}
    >
      {#each numbers as index (index)}
        <option value={index}>{m.builder_block({ number: index + 1 })}</option>
      {/each}
    </select>
  </label>
  <label>
    {m.equipment_wall()}
    <select
      value={marker.wall}
      onchange={(event) => {
        const wall = walls.find(([side]) => side === event.currentTarget.value)?.[0];

        if (wall !== undefined) onchange({ ...marker, wall });
      }}
    >
      {#each walls as [side, label] (side)}
        <option value={side}>{label()}</option>
      {/each}
    </select>
  </label>
  <NumberField
    label={m.equipment_along()}
    value={marker.along}
    min={0}
    onchange={(along) => {
      onchange({ ...marker, along });
    }}
  />
  <label>
    <input
      type="checkbox"
      checked={marker.inside}
      onchange={(event) => {
        onchange({ ...marker, inside: event.currentTarget.checked });
      }}
    />
    {m.equipment_inside()}
  </label>
  <button type="button" onclick={onremove}>{m.builder_remove()}</button>
</fieldset>

<style>
  fieldset {
    display: flex;
    flex-wrap: wrap;
    align-items: end;
    gap: 0.75rem;
  }

  label {
    display: grid;
    gap: 0.25rem;
    font-size: 0.875rem;
  }
</style>
