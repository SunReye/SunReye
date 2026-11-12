<!-- An obstacle's level in the inspector: where it stands, how big it is, and a tree's crown. -->
<script lang="ts">
  import * as Item from "#lib/components/ui/item/index.js";
  import type { Editable } from "../components/value-editor/editable.ts";
  import { m } from "../paraglide/messages.js";
  import { choices, degrees, metres, REACH } from "./fields.ts";
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

  type HedgeObstacle = Extract<Obstacle, { kind: "hedge" }>;

  type RoundObstacle = Exclude<Obstacle, BoxObstacle | HedgeObstacle>;

  type Numeric<T> = { [K in keyof T]: T[K] extends number ? K : never }[keyof T];

  const x = metres(m.field_x(), -REACH, REACH);
  const z = metres(m.field_z(), -REACH, REACH);
  const height = metres(m.field_height(), 0.1, 60);

  const depth = metres(m.field_depth(), 0.1, 60);
  const rotation = degrees(m.field_rotation(), 0, 359);

  const boxFields = [
    ["x", x],
    ["z", z],
    ["width", metres(m.field_width(), 0.1, 60)],
    ["depth", depth],
    ["height", height],
    ["rotation", rotation],
  ] as const satisfies readonly (readonly [Numeric<BoxObstacle>, Editable])[];

  const hedgeFields = [
    ["x", x],
    ["z", z],
    ["length", metres(m.field_length(), 0.1, 60)],
    ["depth", depth],
    ["height", height],
    ["rotation", rotation],
  ] as const satisfies readonly (readonly [Numeric<HedgeObstacle>, Editable])[];

  const roundFields = [
    ["x", x],
    ["z", z],
    ["radius", metres(m.field_radius(), 0.1, 20)],
    ["height", height],
  ] as const satisfies readonly (readonly [Numeric<RoundObstacle>, Editable])[];

  /** The obstacle's sizes with their bounds. */
  const sizes = $derived.by(() => {
    if (item.kind === "box") return boxFields.map(([key, edit]) => [key, edit, item[key]] as const);

    if (item.kind === "hedge") {
      return hedgeFields.map(([key, edit]) => [key, edit, item[key]] as const);
    }

    return roundFields.map(([key, edit]) => [key, edit, item[key]] as const);
  });

  const CROWNS = ["broadleaf", "conifer"] as const;

  const crown = choices(m.field_crown(), [m.crown_broadleaf(), m.crown_conifer()]);
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
  {#if item.kind === "tree"}
    {@const tree = item}
    <ValueRow
      edit={crown}
      value={CROWNS.indexOf(tree.crown ?? "broadleaf")}
      onchange={(index) => {
        onchange({ ...tree, crown: CROWNS[index] ?? "broadleaf" });
      }}
    />
  {/if}
</Item.Group>
<RemoveButton {onremove} />
