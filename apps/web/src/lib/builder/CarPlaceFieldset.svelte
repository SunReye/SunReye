<!-- A car place's level in the inspector: its loadpoint, footprint and body. -->
<script lang="ts">
  import * as Item from "#lib/components/ui/item/index.js";
  import type { Device } from "../api/core.ts";
  import { m } from "../paraglide/messages.js";
  import CarModelField from "./CarModelField.svelte";
  import { choices, degrees, metres, REACH } from "./fields.ts";
  import type { BodyClass, CarPlace } from "./pv.ts";
  import RemoveButton from "./RemoveButton.svelte";
  import ValueRow from "./ValueRow.svelte";

  let {
    place,
    loadpoints,
    onchange,
    onremove,
  }: {
    place: CarPlace;
    /** The EVCC loadpoint devices it may name. */
    loadpoints: readonly Device[];
    onchange: (place: CarPlace) => void;
    onremove: () => void;
  } = $props();

  /** The colour neither the catalogue nor the admin picked. */
  const PLAIN = "#8a8f98";

  type Numeric = "x" | "z" | "width" | "length" | "rotation";

  const fields = [
    ["x", metres(m.field_x(), -REACH, REACH)],
    ["z", metres(m.field_z(), -REACH, REACH)],
    ["width", metres(m.field_width(), 1, 10)],
    ["length", metres(m.field_length(), 2, 20)],
    ["rotation", degrees(m.field_rotation(), 0, 359)],
  ] as const satisfies readonly (readonly [Numeric, unknown])[];

  const CLASSES: readonly (readonly [BodyClass, () => string])[] = [
    ["sedan", m.car_class_sedan],
    ["hatchback", m.car_class_hatchback],
    ["suv", m.car_class_suv],
    ["van", m.car_class_van],
    ["pickup", m.car_class_pickup],
  ];

  const loadpoint = $derived(
    choices(
      m.car_loadpoint(),
      loadpoints.map(({ name }) => name),
    ),
  );

  const kind = choices(
    m.car_class(),
    CLASSES.map(([, label]) => label()),
  );

  const body = $derived(place.body ?? ({ class: "sedan", colour: PLAIN } as const));
</script>

<Item.Group class="gap-0 divide-y divide-border/60">
  <ValueRow
    edit={loadpoint}
    value={loadpoints.findIndex(({ id }) => id === place.device)}
    onchange={(index) => {
      const chosen = loadpoints[index];

      if (chosen !== undefined) onchange({ ...place, device: chosen.id });
    }}
  />
  {#each fields as [key, edit] (key)}
    <ValueRow
      {edit}
      value={place[key]}
      onchange={(value) => {
        onchange({ ...place, [key]: value });
      }}
    />
  {/each}
  <ValueRow
    edit={kind}
    value={CLASSES.findIndex(([option]) => option === body.class)}
    onchange={(index) => {
      const chosen = CLASSES[index]?.[0];

      if (chosen !== undefined) onchange({ ...place, body: { ...body, class: chosen } });
    }}
  />
  <Item.Root class="rounded-none border-0">
    {#snippet child({ props })}
      <label {...props} class={[props.class, "cursor-pointer hover:bg-muted/60"]}>
        <Item.Content>
          <Item.Title class="text-[15px] font-normal">{m.car_colour()}</Item.Title>
        </Item.Content>
        <Item.Actions>
          <span
            class="size-6 rounded-sm ring-1 ring-border ring-inset"
            style:background={body.colour}
          ></span>
          <!-- The swatch is the control; the system picker opens from the label. -->
          <input
            type="color"
            class="sr-only"
            value={body.colour}
            onchange={(event) => {
              onchange({ ...place, body: { ...body, colour: event.currentTarget.value } });
            }}
          />
        </Item.Actions>
      </label>
    {/snippet}
  </Item.Root>
  <CarModelField
    model={place.model}
    onchange={(model) => {
      onchange({ ...place, model });
    }}
  />
</Item.Group>
<RemoveButton {onremove} />
