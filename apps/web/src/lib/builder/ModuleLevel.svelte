<!-- A module tapped on the roof (ADR 20): its string, its optimizer, and its removal. -->
<script lang="ts">
  import * as Item from "#lib/components/ui/item/index.js";
  import { m } from "../paraglide/messages.js";
  import type { Cell, Scene } from "./pv.ts";
  import { paint, type Draft } from "./modules.ts";
  import RemoveButton from "./RemoveButton.svelte";
  import { stringCss } from "./scene.ts";
  import SwitchRow from "./SwitchRow.svelte";

  let {
    draft,
    grid,
    cell,
    onchange,
    onremove,
  }: {
    draft: Draft;
    /** Its grid's position in the scene. */
    grid: number;
    cell: Cell;
    onchange: (draft: Draft) => void;
    onremove: (draft: Draft) => void;
  } = $props();

  const string = $derived(cell.string ?? undefined);

  const name = $derived(
    string === undefined ? m.builder_module_unwired() : (draft.strings[string]?.name ?? ""),
  );

  function edited(scene: Scene): Draft {
    return { ...draft, scene };
  }
</script>

<Item.Group class="gap-0 divide-y divide-border/60">
  <Item.Root class="rounded-none border-0">
    <Item.Media>
      <span class="size-3 rounded-sm" style:background={stringCss(string)}></span>
    </Item.Media>
    <Item.Content>
      <Item.Description>{m.builder_module_string()}</Item.Description>
      <Item.Title class="text-[15px] font-normal">{name}</Item.Title>
    </Item.Content>
  </Item.Root>
  <SwitchRow
    label={m.builder_optimizer()}
    checked={cell.optimized === true}
    onchange={(on) => {
      onchange(edited(paint(draft.scene, grid, cell, { kind: "optimizer", on })));
    }}
  />
</Item.Group>
<RemoveButton
  onremove={() => {
    onremove(edited(paint(draft.scene, grid, cell, { kind: "place", erase: true })));
  }}
/>
