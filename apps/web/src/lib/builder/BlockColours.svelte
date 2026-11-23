<!-- A block's roof and wall colours; an open block has no walls to paint (ADR 20 Colours). -->
<script lang="ts">
  import { m } from "../paraglide/messages.js";
  import ColourRow from "./ColourRow.svelte";
  import { OWN_ROOF, OWN_WALL, ROOF_COLOURS, WALL_COLOURS } from "./colours.ts";
  import type { Block } from "@sunreye/builder/builder/pv.ts";

  let {
    block,
    onchange,
  }: {
    block: Block;
    onchange: (block: Block) => void;
  } = $props();
</script>

<ColourRow
  label={m.block_roof_colour()}
  swatches={ROOF_COLOURS}
  own={OWN_ROOF}
  value={block.roofColour}
  onchange={(roofColour) => {
    onchange({ ...block, roofColour });
  }}
/>
{#if block.open !== true}
  <ColourRow
    label={m.block_wall_colour()}
    swatches={WALL_COLOURS}
    own={OWN_WALL}
    value={block.wallColour}
    onchange={(wallColour) => {
      onchange({ ...block, wallColour });
    }}
  />
{/if}
