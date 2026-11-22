<!-- A roof chimney's or a roof window's level in the inspector: the face it is on, where, and how
  big. -->
<script lang="ts" generics="T extends OnRoof">
  import * as Item from "#lib/components/ui/item/index.js";
  import type { Editable } from "../components/value-editor/editable.ts";
  import { m } from "../paraglide/messages.js";
  import { centred } from "./draft.ts";
  import { choices, metres } from "./fields.ts";
  import type { RoofFace } from "./pv.ts";
  import RemoveButton from "./RemoveButton.svelte";
  import type { OnRoof } from "./roofing.ts";
  import ValueRow from "./ValueRow.svelte";

  let {
    item,
    sizes,
    roofs,
    onchange,
    onremove,
  }: {
    item: T;
    /** Its sizes' rows, each the key of a number of `item`. */
    sizes: readonly (readonly [keyof T & string, Editable])[];
    /** Every roof face it may be on. */
    roofs: readonly RoofFace[];
    onchange: (item: T) => void;
    onremove: () => void;
  } = $props();

  const fields = $derived([
    ["across", metres(m.field_from_left(), 0, 60)] as const,
    ["up", metres(m.field_from_eave(), 0, 30)] as const,
    ...sizes,
  ]);

  const face = $derived(
    choices(
      m.field_roof_face(),
      roofs.map(({ block, face: index }) =>
        m.builder_face_item({ block: block + 1, face: index + 1 }),
      ),
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
      value={Number(item[key])}
      onchange={(value) => {
        onchange({ ...item, [key]: value });
      }}
    />
  {/each}
</Item.Group>
<RemoveButton {onremove} />
