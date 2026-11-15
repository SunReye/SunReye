<!-- An obstacle's, a ground surface's or a fence's level in the inspector (ADR 20 Surroundings). -->
<script lang="ts">
  import FenceFieldset from "./FenceFieldset.svelte";
  import ObstacleFieldset from "./ObstacleFieldset.svelte";
  import type { Scene } from "./pv.ts";
  import SurfaceFieldset from "./SurfaceFieldset.svelte";

  let {
    kind,
    index,
    scene,
    onchange,
    onremove,
  }: {
    kind: "obstacle" | "surface" | "fence";
    index: number;
    scene: Scene;
    onchange: (scene: Scene) => void;
    /** The scene without the object. */
    onremove: (scene: Scene) => void;
  } = $props();

  const obstacle = $derived(kind === "obstacle" ? scene.obstacles[index] : undefined);
  const surfaces = $derived(scene.surfaces ?? []);
  const surface = $derived(kind === "surface" ? surfaces[index] : undefined);
  const fences = $derived(scene.fences ?? []);
  const fence = $derived(kind === "fence" ? fences[index] : undefined);
</script>

{#if obstacle !== undefined}
  <ObstacleFieldset
    item={obstacle}
    onchange={(next) => {
      onchange({ ...scene, obstacles: scene.obstacles.with(index, next) });
    }}
    onremove={() => {
      onremove({ ...scene, obstacles: scene.obstacles.toSpliced(index, 1) });
    }}
  />
{:else if surface !== undefined}
  <SurfaceFieldset
    item={surface}
    onchange={(next) => {
      onchange({ ...scene, surfaces: surfaces.with(index, next) });
    }}
    onremove={() => {
      onremove({ ...scene, surfaces: surfaces.toSpliced(index, 1) });
    }}
  />
{:else if fence !== undefined}
  <FenceFieldset
    item={fence}
    onchange={(next) => {
      onchange({ ...scene, fences: fences.with(index, next) });
    }}
    onremove={() => {
      onremove({ ...scene, fences: fences.toSpliced(index, 1) });
    }}
  />
{/if}
