<!-- A window's or a door's level in the inspector: its kind, wall, place and size (ADR 20). -->
<script lang="ts">
  import * as Item from "#lib/components/ui/item/index.js";
  import type { Editable } from "../components/value-editor/editable.ts";
  import { m } from "../paraglide/messages.js";
  import { choices, metres } from "./fields.ts";
  import { OPENING_KINDS, WALL_NAMES } from "./outline.ts";
  import type { Opening } from "./pv.ts";
  import RemoveButton from "./RemoveButton.svelte";
  import ValueRow from "./ValueRow.svelte";
  import type { Unfit } from "./pv.ts";
  import { USUAL } from "./wall-openings.ts";

  let {
    item,
    blocks,
    refused,
    onchange,
    onremove,
  }: {
    item: Opening;
    /** How many blocks the scene has. */
    blocks: number;
    /** Why the last change was not made, if it was not. */
    refused: Unfit | undefined;
    /** A change the wall has no room for, or one over another opening, is not made. */
    onchange: (change: Partial<Opening>) => void;
    onremove: () => void;
  } = $props();

  type Numeric = "along" | "width" | "height" | "sill";

  const kind = choices(
    m.opening_kind(),
    OPENING_KINDS.map(([, label]) => label()),
  );

  const block = $derived(
    choices(
      m.equipment_block(),
      Array.from({ length: blocks }, (_, index) => m.builder_block({ number: index + 1 })),
    ),
  );

  const wall = choices(
    m.equipment_wall(),
    WALL_NAMES.map(([, label]) => label()),
  );

  const SIZES = [
    ["along", metres(m.equipment_along(), 0, 60)],
    ["width", metres(m.field_width(), 0.4, 20)],
    ["height", metres(m.field_height(), 0.4, 10)],
  ] as const satisfies readonly (readonly [Numeric, Editable])[];

  const SILL = ["sill", metres(m.opening_sill(), 0, 10)] as const;

  const REASONS: Readonly<Record<Unfit, () => string>> = {
    overlap: m.opening_refused_overlap,
    room: m.opening_refused_room,
  };

  /** A door stands on the ground: it has no sill to set. */
  const fields = $derived(
    item.kind === "frontDoor" || item.kind === "garageDoor" ? SIZES : [...SIZES, SILL],
  );
</script>

<Item.Group class="gap-0 divide-y divide-border/60">
  <ValueRow
    edit={kind}
    value={OPENING_KINDS.findIndex(([name]) => name === item.kind)}
    onchange={(index) => {
      const chosen = OPENING_KINDS[index]?.[0];

      // Another kind comes in its usual size.
      if (chosen !== undefined) onchange({ kind: chosen, ...USUAL[chosen] });
    }}
  />
  <ValueRow
    edit={block}
    value={item.block}
    onchange={(index) => {
      onchange({ block: index });
    }}
  />
  <ValueRow
    edit={wall}
    value={WALL_NAMES.findIndex(([side]) => side === item.wall)}
    onchange={(index) => {
      const side = WALL_NAMES[index]?.[0];

      if (side !== undefined) onchange({ wall: side });
    }}
  />
  {#each fields as [key, edit] (key)}
    <ValueRow
      {edit}
      value={item[key] ?? 0}
      onchange={(value) => {
        onchange({ [key]: value });
      }}
    />
  {/each}
</Item.Group>
{#if refused !== undefined}
  <p role="alert" class="px-4 py-2 text-sm text-destructive">{REASONS[refused]()}</p>
{/if}
<RemoveButton {onremove} />
