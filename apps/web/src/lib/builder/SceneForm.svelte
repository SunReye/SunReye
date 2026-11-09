<script lang="ts">
  import { m } from "../paraglide/messages.js";
  import BlockFieldset from "./BlockFieldset.svelte";
  import { nextBlock, obstacle } from "./draft.ts";
  import { withoutBlock } from "./modules.ts";
  import ObstacleFieldset from "./ObstacleFieldset.svelte";
  import type { Obstacle, Scene } from "./pv.ts";

  let { scene = $bindable() }: { scene: Scene } = $props();

  const additions: readonly (readonly [Obstacle["kind"], () => string])[] = [
    ["box", m.builder_add_box],
    ["cylinder", m.builder_add_cylinder],
    ["tree", m.builder_add_tree],
  ];
</script>

<form
  onsubmit={(event) => {
    event.preventDefault();
  }}
>
  <label class="compass">
    {m.builder_compass()}
    <input
      type="range"
      min="0"
      max="359"
      value={scene.north}
      oninput={(event) => {
        scene = { ...scene, north: event.currentTarget.valueAsNumber };
      }}
    />
    <svg viewBox="-10 -10 20 20" aria-hidden="true">
      <circle r="9" />
      <!-- The needle points to true north, seen from the scene's forward axis. -->
      <path d="M0 -8 L2.5 0 L-2.5 0 Z" transform="rotate({-scene.north})" />
    </svg>
  </label>

  {#each scene.blocks as block, index}
    <BlockFieldset
      {block}
      number={index + 1}
      onchange={(next) => {
        scene = { ...scene, blocks: scene.blocks.with(index, next) };
      }}
      onremove={scene.blocks.length > 1
        ? () => {
            scene = withoutBlock(scene, index);
          }
        : undefined}
    />
  {/each}
  <button
    type="button"
    onclick={() => {
      scene = { ...scene, blocks: [...scene.blocks, nextBlock(scene.blocks)] };
    }}>{m.builder_add_block()}</button
  >

  <h2>{m.builder_obstacles()}</h2>
  {#each scene.obstacles as item, index}
    <ObstacleFieldset
      {item}
      onchange={(next) => {
        scene = { ...scene, obstacles: scene.obstacles.with(index, next) };
      }}
      onremove={() => {
        scene = { ...scene, obstacles: scene.obstacles.toSpliced(index, 1) };
      }}
    />
  {/each}
  {#each additions as [kind, label] (kind)}
    <button
      type="button"
      onclick={() => {
        scene = { ...scene, obstacles: [...scene.obstacles, obstacle(kind)] };
      }}>{label()}</button
    >
  {/each}
</form>

<style>
  form {
    display: grid;
    gap: 1rem;
    align-content: start;
  }

  .compass {
    display: grid;
    grid-template-columns: 1fr 3rem;
    align-items: center;
    gap: 0.5rem;
  }

  svg {
    grid-row: span 2;
    grid-column: 2;
    width: 3rem;
  }

  circle {
    fill: none;
    stroke: currentcolor;
  }

  path {
    fill: #c0392b;
  }
</style>
