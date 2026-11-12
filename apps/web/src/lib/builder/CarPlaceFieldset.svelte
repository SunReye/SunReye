<!-- A car place's level in the inspector: its loadpoint, footprint, colour and body. -->
<script lang="ts">
  import * as Item from "#lib/components/ui/item/index.js";
  import type { Device } from "../api/core.ts";
  import { PLAIN } from "../cars/parked.ts";
  import { m } from "../paraglide/messages.js";
  import CarModelField from "./CarModelField.svelte";
  import { choices, degrees, metres, REACH } from "./fields.ts";
  import type { CarPlace } from "./pv.ts";
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

  type Numeric = "x" | "z" | "width" | "length" | "rotation";

  const fields = [
    ["x", metres(m.field_x(), -REACH, REACH)],
    ["z", metres(m.field_z(), -REACH, REACH)],
    ["width", metres(m.field_width(), 1, 10)],
    ["length", metres(m.field_length(), 2, 20)],
    ["rotation", degrees(m.field_rotation(), 0, 359)],
  ] as const satisfies readonly (readonly [Numeric, unknown])[];

  const loadpoint = $derived(
    choices(
      m.car_loadpoint(),
      loadpoints.map(({ name }) => name),
    ),
  );

  const colour = $derived(place.colour ?? PLAIN);
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
  <Item.Root class="rounded-none border-0">
    {#snippet child({ props })}
      <label {...props} class={[props.class, "cursor-pointer hover:bg-muted/60"]}>
        <Item.Content>
          <Item.Title class="text-[15px] font-normal">{m.car_colour()}</Item.Title>
        </Item.Content>
        <Item.Actions>
          <span
            class="size-6 rounded-sm ring-1 ring-border ring-inset"
            style:background={colour}
          ></span>
          <!-- The swatch is the control; the system picker opens from the label. -->
          <input
            type="color"
            class="sr-only"
            value={colour}
            onchange={(event) => {
              onchange({ ...place, colour: event.currentTarget.value });
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
