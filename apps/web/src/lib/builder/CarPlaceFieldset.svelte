<script lang="ts">
  import type { Device } from "../api/core.ts";
  import { m } from "../paraglide/messages.js";
  import CarModelField from "./CarModelField.svelte";
  import NumberField from "./NumberField.svelte";
  import type { BodyClass, CarPlace } from "./pv.ts";

  let {
    place,
    number,
    loadpoints,
    onchange,
    onremove,
  }: {
    place: CarPlace;
    /** From 1, as the admin counts. */
    number: number;
    /** The EVCC loadpoint devices it may name. */
    loadpoints: readonly Device[];
    onchange: (place: CarPlace) => void;
    onremove: () => void;
  } = $props();

  /** The colour neither the catalogue nor the admin picked. */
  const PLAIN = "#8a8f98";

  type Numeric = "x" | "z" | "width" | "length" | "rotation";

  const fields: readonly (readonly [Numeric, () => string])[] = [
    ["x", m.field_x],
    ["z", m.field_z],
    ["width", m.field_width],
    ["length", m.field_length],
    ["rotation", m.field_rotation],
  ];

  const classes: readonly (readonly [BodyClass, () => string])[] = [
    ["sedan", m.car_class_sedan],
    ["hatchback", m.car_class_hatchback],
    ["suv", m.car_class_suv],
    ["van", m.car_class_van],
    ["pickup", m.car_class_pickup],
  ];

  const body = $derived(place.body ?? ({ class: "sedan", colour: PLAIN } as const));

  function chooseClass(value: string): void {
    const kind = classes.find(([option]) => option === value)?.[0];

    if (kind !== undefined) onchange({ ...place, body: { ...body, class: kind } });
  }
</script>

<fieldset>
  <legend>{m.car_place({ number })}</legend>
  <label>
    {m.car_loadpoint()}
    <select
      value={place.device}
      onchange={(event) => {
        onchange({ ...place, device: Number(event.currentTarget.value) });
      }}
    >
      {#each loadpoints as device (device.id)}
        <option value={device.id}>{device.name}</option>
      {/each}
    </select>
  </label>
  {#each fields as [key, label] (key)}
    <NumberField
      label={label()}
      value={place[key]}
      onchange={(value) => {
        onchange({ ...place, [key]: value });
      }}
    />
  {/each}
  <label>
    {m.car_class()}
    <select
      value={body.class}
      onchange={(event) => {
        chooseClass(event.currentTarget.value);
      }}
    >
      {#each classes as [kind, label] (kind)}
        <option value={kind}>{label()}</option>
      {/each}
    </select>
  </label>
  <label>
    {m.car_colour()}
    <input
      type="color"
      value={body.colour}
      onchange={(event) => {
        onchange({ ...place, body: { ...body, colour: event.currentTarget.value } });
      }}
    />
  </label>
  <CarModelField
    model={place.model}
    onchange={(model) => {
      onchange({ ...place, model });
    }}
  />
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
