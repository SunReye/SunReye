<!-- A roof chimney's level in the inspector: the face it stands on, where, and how big. -->
<script lang="ts">
  import * as Item from "#lib/components/ui/item/index.js";
  import type { Editable } from "../components/value-editor/editable.ts";
  import { m } from "../paraglide/messages.js";
  import { centred } from "./draft.ts";
  import { choices, metres } from "./fields.ts";
  import type { Chimney, RoofFace } from "./pv.ts";
  import RemoveButton from "./RemoveButton.svelte";
  import ValueRow from "./ValueRow.svelte";

  let {
    item,
    roofs,
    onchange,
    onremove,
  }: {
    item: Chimney;
    /** Every roof face it may stand on. */
    roofs: readonly RoofFace[];
    onchange: (item: Chimney) => void;
    onremove: () => void;
  } = $props();

  type Numeric = "across" | "up" | "width" | "depth" | "height";

  const fields = [
    ["across", metres(m.field_from_left(), 0, 60)],
    ["up", metres(m.field_from_eave(), 0, 30)],
    ["width", metres(m.field_width(), 0.2, 3)],
    ["depth", metres(m.field_depth(), 0.2, 3)],
    ["height", metres(m.field_height(), 0.1, 5)],
  ] as const satisfies readonly (readonly [Numeric, Editable])[];

  const face = $derived(
    choices(
      m.field_roof_face(),
      roofs.map(({ block, face: index }) => m.builder_face_item({ block: block + 1, face: index + 1 })),
    ),
  );
</script>

<Item.Group class="gap-0 divide-y divide-border/60">
  <ValueRow
    edit={face}
    value={roofs.findIndex(({ block, face: index }) => block === item.block && index === item.face)}
    onchange={(index) => {
      const roof = roofs[index];

      // On another face it starts in that face's middle.
      if (roof !== undefined) {
        onchange({ ...item, block: roof.block, face: roof.face, ...centred(roof) });
      }
    }}
  />
  {#each fields as [key, edit] (key)}
    <ValueRow
      {edit}
      value={item[key]}
      onchange={(value) => {
        onchange({ ...item, [key]: value });
      }}
    />
  {/each}
</Item.Group>
<RemoveButton {onremove} />
