<!-- A window's or a door's level in the inspector: its kind, wall, place and size (ADR 20). -->
<script lang="ts">
  import { Button } from "#lib/components/ui/button/index.js";
  import * as Item from "#lib/components/ui/item/index.js";
  import type { Editable } from "../components/value-editor/editable.ts";
  import { m } from "../paraglide/messages.js";
  import { choices, metres } from "./fields.ts";
  import { OPENING_KINDS, UNFIT, WALL_NAMES } from "./outline.ts";
  import RemoveButton from "./RemoveButton.svelte";
  import ValueRow from "./ValueRow.svelte";
  import type { Opening, Unfit } from "./pv.ts";
  import { USUAL } from "./wall-openings.ts";

  let {
    item,
    blocks,
    refused,
    onchange,
    oncopy,
    onremove,
  }: {
    item: Opening;
    /** How many blocks the scene has. */
    blocks: number;
    /** Why the last change was not made, if it was not. */
    refused: Unfit | undefined;
    /** A change the wall has no room for, or one over another opening, is not made. */
    onchange: (change: Partial<Opening>) => void;
    /** Adds one like it beside it on its wall. */
    oncopy: () => void;
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

  const LIGHTS = ["auto", "on", "off"] as const;

  const light = choices(m.opening_light(), [
    m.opening_light_auto(),
    m.opening_light_on(),
    m.opening_light_off(),
  ]);

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
  {#if item.kind !== "garageDoor"}
    <!-- A garage door has no glass to light (ADR 20 Night). -->
    <ValueRow
      edit={light}
      value={LIGHTS.indexOf(item.light ?? "auto")}
      onchange={(index) => {
        onchange({ light: LIGHTS[index] ?? "auto" });
      }}
    />
  {/if}
</Item.Group>
{#if refused !== undefined}
  <p role="alert" class="px-4 py-2 text-sm text-destructive">{UNFIT[refused]()}</p>
{/if}
<div class="border-t border-border/60 px-3 pt-3">
  <Button variant="outline" class="min-h-11 w-full" onclick={oncopy}>
    {m.builder_duplicate()}
  </Button>
</div>
<RemoveButton {onremove} />
