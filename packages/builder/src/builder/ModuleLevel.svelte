<!-- A module tapped on the roof (ADR 20): its string, picked or new, its orientation, its optimizer,
  and its removal. -->
<script lang="ts">
  import * as Item from "@sunreye/ui/item";
  import { m } from "../paraglide/messages.js";
  import { choices } from "./fields.ts";
  import type { GridModule, Scene } from "@sunreye/builder/builder/pv.ts";
  import { addString, optimize, wire, type Draft } from "@sunreye/builder/builder/modules.ts";
  import { move } from "@sunreye/builder/builder/placing.ts";
  import RemoveButton from "./RemoveButton.svelte";
  import SwitchRow from "./SwitchRow.svelte";
  import ValueRow from "./ValueRow.svelte";

  let {
    draft,
    grid,
    module,
    laid,
    onchange,
    onremove,
  }: {
    draft: Draft;
    /** Its grid's position in the scene. */
    grid: number;
    /** Its position in its grid. */
    module: number;
    laid: GridModule;
    onchange: (draft: Draft) => void;
    onremove: () => void;
  } = $props();

  const string = $derived(laid.string ?? undefined);

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

  const orientation = choices(m.builder_orientation(), [
    m.builder_portrait(),
    m.builder_landscape(),
  ]);

  function edited(scene: Scene): Draft {
    return { ...draft, scene };
  }

  /** Into choice `value`'s string: none, a joinable one, or a new one of its grid's type. */
  function rewire(value: number): void {
    if (value === 0) {
      onchange(edited(wire(draft.scene, grid, module)));

      return;
    }

    const joined = joinable[value - 1];

    if (joined !== undefined) {
      onchange(edited(wire(draft.scene, grid, module, joined)));

      return;
    }

    if (moduleType === undefined) return;

    const index = draft.strings.length;
    const added = addString(draft, m.builder_string_default({ number: index + 1 }), moduleType);

    onchange({
      ...added,
      scene: wire(added.scene, grid, module, index),
    });
  }
</script>

<Item.Group class="gap-0 divide-y divide-border/60">
  <ValueRow edit={pick} value={picked} onchange={rewire} />
  <ValueRow
    edit={orientation}
    value={laid.landscape ? 1 : 0}
    onchange={(index) => {
      onchange(edited(move(draft.scene, grid, module, { landscape: index === 1 })));
    }}
  />
  <SwitchRow
    label={m.builder_optimizer()}
    checked={laid.optimized === true}
    onchange={(on) => {
      onchange(edited(optimize(draft.scene, grid, module, on)));
    }}
  />
</Item.Group>
<RemoveButton {onremove} />
