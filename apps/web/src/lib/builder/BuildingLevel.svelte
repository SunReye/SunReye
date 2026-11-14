<!-- A block's, a roof chimney's or an opening's level in the inspector (ADR 20 Blocks). -->
<script lang="ts">
  import BlockFieldset from "./BlockFieldset.svelte";
  import ChimneyFieldset from "./ChimneyFieldset.svelte";
  import { withoutBlock } from "./modules.ts";
  import OpeningFieldset from "./OpeningFieldset.svelte";
  import type { RoofFace, Scene } from "./pv.ts";
  import { refit } from "./wall-openings.ts";

  let {
    kind,
    index,
    scene,
    roofs,
    onchange,
    onremove,
  }: {
    kind: "block" | "chimney" | "opening";
    index: number;
    scene: Scene;
    /** The roof faces a chimney may stand on. */
    roofs: readonly RoofFace[];
    onchange: (scene: Scene) => void;
    /** The scene without the object. */
    onremove: (scene: Scene) => void;
  } = $props();

  const block = $derived(kind === "block" ? scene.blocks[index] : undefined);
  const chimneys = $derived(scene.chimneys ?? []);
  const chimney = $derived(kind === "chimney" ? chimneys[index] : undefined);
  const openings = $derived(scene.openings ?? []);
  const opening = $derived(kind === "opening" ? openings[index] : undefined);

  // A scene keeps at least one block.
  const removeBlock = $derived(
    scene.blocks.length > 1
      ? () => {
          onremove(withoutBlock(scene, index));
        }
      : undefined,
  );
</script>

{#if block !== undefined}
  <BlockFieldset
    {block}
    onchange={(next) => {
      onchange({ ...scene, blocks: scene.blocks.with(index, next) });
    }}
    onremove={removeBlock}
  />
{:else if chimney !== undefined}
  <ChimneyFieldset
    item={chimney}
    {roofs}
    onchange={(next) => {
      onchange({ ...scene, chimneys: chimneys.with(index, next) });
    }}
    onremove={() => {
      onremove({ ...scene, chimneys: chimneys.toSpliced(index, 1) });
    }}
  />
{:else if opening !== undefined}
  <OpeningFieldset
    item={opening}
    blocks={scene.blocks.length}
    onchange={(change) => {
      const fitted = refit(scene, index, change);

      if (fitted !== null) onchange(fitted);
    }}
    onremove={() => {
      onremove({ ...scene, openings: openings.toSpliced(index, 1) });
    }}
  />
{/if}
