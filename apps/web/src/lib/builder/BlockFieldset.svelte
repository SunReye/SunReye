<!-- A block's level in the inspector: its footprint, eave, roof, overhang, colours and whether it is a carport;
  a free-form block's colours and carport only, its rectangle going unused (ADR 20). -->
<script lang="ts">
  import * as Item from "@sunreye/ui/item";
  import { m } from "../paraglide/messages.js";
  import BlockColours from "./BlockColours.svelte";
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

  const eave = metres(m.field_eave_overhang(), 0, 2, 0.05);
  const verge = metres(m.field_verge_overhang(), 0, 2, 0.05);

  const overhang = $derived(block.overhang ?? { eave: 0, verge: 0 });

  /** Only a mono-pitch or gable roof has verges; a flat or hip roof has eaves all round. */
  const verged = $derived(block.roof.kind === "monoPitch" || block.roof.kind === "gable");
</script>

<Item.Group class="gap-0 divide-y divide-border/60">
  {#if !block.freeForm}
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
    <ValueRow
      edit={eave}
      value={overhang.eave}
      onchange={(value) => {
        onchange({ ...block, overhang: { ...overhang, eave: value } });
      }}
    />
    {#if verged}
      <ValueRow
        edit={verge}
        value={overhang.verge}
        onchange={(value) => {
          onchange({ ...block, overhang: { ...overhang, verge: value } });
        }}
      />
    {/if}
  {/if}
  <BlockColours {block} {onchange} />
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
