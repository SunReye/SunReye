<script lang="ts">
  import { m } from "../paraglide/messages.js";
  import NumberField from "./NumberField.svelte";
  import type { Obstacle } from "./pv.ts";

  let {
    item,
    onchange,
    onremove,
  }: {
    item: Obstacle;
    onchange: (item: Obstacle) => void;
    onremove: () => void;
  } = $props();

  type BoxObstacle = Extract<Obstacle, { kind: "box" }>;

  type RoundObstacle = Exclude<Obstacle, BoxObstacle>;

  type Numeric<T> = { [K in keyof T]: T[K] extends number ? K : never }[keyof T];

  const names: Readonly<Record<Obstacle["kind"], () => string>> = {
    box: m.obstacle_box,
    cylinder: m.obstacle_cylinder,
    tree: m.obstacle_tree,
  };

  const boxFields = [
    ["x", m.field_x],
    ["z", m.field_z],
    ["width", m.field_width],
    ["depth", m.field_depth],
    ["height", m.field_height],
    ["rotation", m.field_rotation],
  ] as const satisfies readonly (readonly [Numeric<BoxObstacle>, () => string])[];

  const roundFields = [
    ["x", m.field_x],
    ["z", m.field_z],
    ["radius", m.field_radius],
    ["height", m.field_height],
  ] as const satisfies readonly (readonly [Numeric<RoundObstacle>, () => string])[];

  /** The obstacle's sizes with their labels. */
  const sizes = $derived(
    item.kind === "box"
      ? boxFields.map(([key, label]) => [key, label, item[key]] as const)
      : roundFields.map(([key, label]) => [key, label, item[key]] as const),
  );
</script>

<fieldset>
  <legend>{names[item.kind]()}</legend>
  {#each sizes as [key, label, value] (key)}
    <NumberField
      label={label()}
      {value}
      onchange={(next) => {
        onchange({ ...item, [key]: next });
      }}
    />
  {/each}
  <button type="button" onclick={onremove}>{m.builder_remove()}</button>
</fieldset>

<style>
  fieldset {
    display: flex;
    flex-wrap: wrap;
    gap: 0.75rem;
  }
</style>
