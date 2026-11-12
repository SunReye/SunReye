<!-- A block's level in the inspector: its footprint, eave, roof and whether it is a carport. -->
<script lang="ts">
  import * as Item from "#lib/components/ui/item/index.js";
  import { m } from "../paraglide/messages.js";
  import { withRoof } from "./draft.ts";
  import { choices, degrees, metres, REACH } from "./fields.ts";
  import { ROOFS } from "./outline.ts";
  import type { Block } from "./pv.ts";
  import RemoveButton from "./RemoveButton.svelte";
  import SwitchRow from "./SwitchRow.svelte";
  import ValueRow from "./ValueRow.svelte";

  let {
    block,
    onchange,
    onremove,
  }: {
    block: Block;
    onchange: (block: Block) => void;
    /** Without it the block stays: a scene keeps at least one. */
    onremove: (() => void) | undefined;
  } = $props();

  type Numeric = "x" | "z" | "width" | "depth" | "eave" | "rotation";

  const fields = [
    ["x", metres(m.field_x(), -REACH, REACH)],
    ["z", metres(m.field_z(), -REACH, REACH)],
    ["width", metres(m.field_width(), 1, 60)],
    ["depth", metres(m.field_depth(), 1, 60)],
    ["eave", metres(m.field_eave(), 1, 30)],
    ["rotation", degrees(m.field_rotation(), 0, 359)],
  ] as const satisfies readonly (readonly [Numeric, unknown])[];

  const roof = choices(
    m.field_roof(),
    ROOFS.map(([, label]) => label()),
  );

  const pitch = degrees(m.field_pitch(), 0, 60);
</script>

<Item.Group class="gap-0 divide-y divide-border/60">
  {#each fields as [key, edit] (key)}
    <ValueRow
      {edit}
      value={block[key]}
      onchange={(value) => {
        onchange({ ...block, [key]: value });
      }}
    />
  {/each}
  <ValueRow
    edit={roof}
    value={ROOFS.findIndex(([kind]) => kind === block.roof.kind)}
    onchange={(index) => {
      const kind = ROOFS[index]?.[0];

      if (kind !== undefined) onchange({ ...block, roof: withRoof(block.roof, kind) });
    }}
  />
  {#if block.roof.kind !== "flat"}
    {@const pitched = block.roof}
    <ValueRow
      edit={pitch}
      value={pitched.pitch}
      onchange={(value) => {
        onchange({ ...block, roof: { ...pitched, pitch: value } });
      }}
    />
  {/if}
  <SwitchRow
    label={m.block_carport()}
    checked={block.open === true}
    onchange={(open) => {
      onchange({ ...block, open });
    }}
  />
</Item.Group>
{#if onremove !== undefined}
  <RemoveButton {onremove} />
{/if}
