<script lang="ts">
  import { m } from "../paraglide/messages.js";
  import { withRoof } from "./draft.ts";
  import NumberField from "./NumberField.svelte";
  import type { Block, Roof } from "./pv.ts";

  let {
    block,
    number,
    onchange,
    onremove,
  }: {
    block: Block;
    /** From 1, as the admin counts. */
    number: number;
    onchange: (block: Block) => void;
    /** Without it the block stays: a scene keeps at least one. */
    onremove: (() => void) | undefined;
  } = $props();

  type Numeric = { [K in keyof Block]: Block[K] extends number ? K : never }[keyof Block];

  const fields: readonly (readonly [Numeric, () => string])[] = [
    ["x", m.field_x],
    ["z", m.field_z],
    ["width", m.field_width],
    ["depth", m.field_depth],
    ["eave", m.field_eave],
    ["rotation", m.field_rotation],
  ];

  const roofs: readonly (readonly [Roof["kind"], () => string])[] = [
    ["flat", m.roof_flat],
    ["monoPitch", m.roof_monoPitch],
    ["gable", m.roof_gable],
    ["hip", m.roof_hip],
  ];

  function chooseRoof(value: string): void {
    const kind = roofs.find(([option]) => option === value)?.[0];

    if (kind !== undefined) onchange({ ...block, roof: withRoof(block.roof, kind) });
  }
</script>

<fieldset>
  <legend>{m.builder_block({ number })}</legend>
  {#each fields as [key, label] (key)}
    <NumberField
      label={label()}
      value={block[key]}
      onchange={(value) => {
        onchange({ ...block, [key]: value });
      }}
    />
  {/each}
  <label>
    {m.field_roof()}
    <select
      value={block.roof.kind}
      onchange={(event) => {
        chooseRoof(event.currentTarget.value);
      }}
    >
      {#each roofs as [kind, label] (kind)}
        <option value={kind}>{label()}</option>
      {/each}
    </select>
  </label>
  {#if block.roof.kind !== "flat"}
    {@const roof = block.roof}
    <NumberField
      label={m.field_pitch()}
      min={0}
      max={60}
      value={roof.pitch}
      onchange={(pitch) => {
        onchange({ ...block, roof: { ...roof, pitch } });
      }}
    />
  {/if}
  {#if onremove !== undefined}
    <button type="button" onclick={onremove}>{m.builder_remove()}</button>
  {/if}
</fieldset>

<style>
  fieldset {
    display: flex;
    flex-wrap: wrap;
    gap: 0.75rem;
  }
</style>
