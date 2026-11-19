<!-- A block's, a roof chimney's, a roof window's or an opening's level in the inspector (ADR 20
  Blocks). -->
<script lang="ts">
  import { haptics } from "../haptics.ts";
  import BlockFieldset from "./BlockFieldset.svelte";
  import { withoutBlock } from "./modules.ts";
  import OpeningFieldset from "./OpeningFieldset.svelte";
  import type { Pv, RoofFace, Scene, Unfit } from "./pv.ts";
  import { chimneySizes, windowSizes } from "./roof-fields.ts";
  import RoofFieldset from "./RoofFieldset.svelte";
  import { duplicate, refit } from "./wall-openings.ts";

  let {
    kind,
    index,
    scene,
    roofs,
    pv,
    onchange,
    onadd,
    onremove,
  }: {
    kind: "block" | "chimney" | "roofWindow" | "opening";
    index: number;
    scene: Scene;
    /** The roof faces a chimney may stand on and a roof window lie in. */
    roofs: readonly RoofFace[];
    /** The crate, which keeps a changed opening on its wall. */
    pv: Pick<Pv, "refit">;
    onchange: (scene: Scene) => void;
    /** The scene with one opening more, the last, which is picked. */
    onadd: (scene: Scene) => void;
    /** The scene without the object. */
    onremove: (scene: Scene) => void;
  } = $props();

  const block = $derived(kind === "block" ? scene.blocks[index] : undefined);
  const chimneys = $derived(scene.chimneys ?? []);
  const chimney = $derived(kind === "chimney" ? chimneys[index] : undefined);
  const windows = $derived(scene.roofWindows ?? []);
  const window = $derived(kind === "roofWindow" ? windows[index] : undefined);
  const openings = $derived(scene.openings ?? []);
  const opening = $derived(kind === "opening" ? openings[index] : undefined);

  /** Why the last change to the opening was not made, until one is. */
  let unfit = $state<Unfit>();

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
  <RoofFieldset
    item={chimney}
    sizes={chimneySizes()}
    {roofs}
    onchange={(next) => {
      onchange({ ...scene, chimneys: chimneys.with(index, next) });
    }}
    onremove={() => {
      onremove({ ...scene, chimneys: chimneys.toSpliced(index, 1) });
    }}
  />
{:else if window !== undefined}
  <RoofFieldset
    item={window}
    sizes={windowSizes()}
    {roofs}
    onchange={(next) => {
      onchange({ ...scene, roofWindows: windows.with(index, next) });
    }}
    onremove={() => {
      onremove({ ...scene, roofWindows: windows.toSpliced(index, 1) });
    }}
  />
{:else if opening !== undefined}
  <OpeningFieldset
    item={opening}
    blocks={scene.blocks.length}
    refused={unfit}
    onchange={(change) => {
      const fitted = refit(pv, scene, index, change);

      if ("unfit" in fitted) {
        haptics.error();
        ({ unfit } = fitted);
      } else {
        unfit = undefined;
        onchange(fitted);
      }
    }}
    oncopy={() => {
      const copied = duplicate(pv, scene, index);

      if (copied === null) haptics.error();
      else onadd(copied);

      unfit = copied === null ? "room" : undefined;
    }}
    onremove={() => {
      onremove({ ...scene, openings: openings.toSpliced(index, 1) });
    }}
  />
{/if}
