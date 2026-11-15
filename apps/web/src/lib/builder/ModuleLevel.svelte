<!-- A module tapped on the roof (ADR 20): its string, picked or new, its optimizer, and its removal. -->
<script lang="ts">
  import * as Item from "#lib/components/ui/item/index.js";
  import { m } from "../paraglide/messages.js";
  import { choices } from "./fields.ts";
  import type { Cell, Scene } from "./pv.ts";
  import { addString, paint, type Draft } from "./modules.ts";
  import RemoveButton from "./RemoveButton.svelte";
  import SwitchRow from "./SwitchRow.svelte";
  import ValueRow from "./ValueRow.svelte";

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

  const moduleType = $derived(draft.scene.grids?.[grid]?.moduleType);

  /** The strings it may join, by position: those of its grid's module type, and its own. */
  const joinable = $derived(
    draft.strings.flatMap((item, index) =>
      item.moduleType === moduleType || index === string ? [index] : [],
    ),
  );

  /** Unwired first, then the joinable strings, then a new one. */
  const pick = $derived(
    choices(m.builder_module_string(), [
      m.builder_module_unwired(),
      ...joinable.map((index) => draft.strings[index]?.name ?? ""),
      m.builder_module_new_string(),
    ]),
  );

  const picked = $derived(string === undefined ? 0 : joinable.indexOf(string) + 1);

  function edited(scene: Scene): Draft {
    return { ...draft, scene };
  }

  /** Into choice `value`'s string: none, a joinable one, or a new one of its grid's type. */
  function wire(value: number): void {
    if (value === 0) {
      onchange(edited(paint(draft.scene, grid, cell, { kind: "paint", erase: false })));

      return;
    }

    const joined = joinable[value - 1];

    if (joined !== undefined) {
      onchange(edited(paint(draft.scene, grid, cell, { kind: "paint", string: joined, erase: false })));

      return;
    }

    if (moduleType === undefined) return;

    const index = draft.strings.length;
    const added = addString(draft, m.builder_string_default({ number: index + 1 }), moduleType);

    onchange({
      ...added,
      scene: paint(added.scene, grid, cell, { kind: "paint", string: index, erase: false }),
    });
  }
</script>

<Item.Group class="gap-0 divide-y divide-border/60">
  <ValueRow edit={pick} value={picked} onchange={wire} />
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
