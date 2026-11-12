<!-- An obstacle's level in the inspector: where it stands and how big it is. -->
<script lang="ts">
  import * as Item from "#lib/components/ui/item/index.js";
  import type { Editable } from "../components/value-editor/editable.ts";
  import { m } from "../paraglide/messages.js";
  import { degrees, metres, REACH } from "./fields.ts";
  import type { Obstacle } from "./pv.ts";
  import RemoveButton from "./RemoveButton.svelte";
  import ValueRow from "./ValueRow.svelte";

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

  const x = metres(m.field_x(), -REACH, REACH);
  const z = metres(m.field_z(), -REACH, REACH);
  const height = metres(m.field_height(), 0.1, 60);

  const boxFields = [
    ["x", x],
    ["z", z],
    ["width", metres(m.field_width(), 0.1, 60)],
    ["depth", metres(m.field_depth(), 0.1, 60)],
    ["height", height],
    ["rotation", degrees(m.field_rotation(), 0, 359)],
  ] as const satisfies readonly (readonly [Numeric<BoxObstacle>, Editable])[];

  const roundFields = [
    ["x", x],
    ["z", z],
    ["radius", metres(m.field_radius(), 0.1, 20)],
    ["height", height],
  ] as const satisfies readonly (readonly [Numeric<RoundObstacle>, Editable])[];

  /** The obstacle's sizes with their bounds. */
  const sizes = $derived(
    item.kind === "box"
      ? boxFields.map(([key, edit]) => [key, edit, item[key]] as const)
      : roundFields.map(([key, edit]) => [key, edit, item[key]] as const),
  );
</script>

<Item.Group class="gap-0 divide-y divide-border/60">
  {#each sizes as [key, edit, value] (key)}
    <ValueRow
      {edit}
      {value}
      onchange={(next) => {
        onchange({ ...item, [key]: next });
      }}
    />
  {/each}
</Item.Group>
<RemoveButton {onremove} />
