<!-- One object's level in the inspector; a face's level is its module-grid editor (ADR 20). -->
<script lang="ts">
  import type { ModuleType } from "../api/core.ts";
  import BlockFieldset from "./BlockFieldset.svelte";
  import CarPlaceFieldset from "./CarPlaceFieldset.svelte";
  import EquipmentFieldset from "./EquipmentFieldset.svelte";
  import FaceLevel from "./FaceLevel.svelte";
  import { parent, type Level } from "./levels.ts";
  import { painted, withoutBlock, withoutString, type Draft } from "./modules.ts";
  import ObstacleFieldset from "./ObstacleFieldset.svelte";
  import type { Plan } from "./outline.ts";
  import StringFieldset from "./StringFieldset.svelte";

  let {
    level,
    plan,
    moduleTypes,
    moduleType,
    onchange,
    onlevel,
  }: {
    level: Exclude<Level, { kind: "root" | "section" }>;
    plan: Plan;
    moduleTypes: readonly ModuleType[];
    /** A new grid's module type; without one no grid is laid. */
    moduleType: number | undefined;
    onchange: (draft: Draft) => void;
    onlevel: (level: Level) => void;
  } = $props();

  const draft = $derived(plan.draft);
  const scene = $derived(draft.scene);
  const index = $derived("index" in level ? level.index : -1);

  /** The object the level names, by its kind; undefined for every other kind. */
  const block = $derived(level.kind === "block" ? scene.blocks[index] : undefined);
  const obstacle = $derived(level.kind === "obstacle" ? scene.obstacles[index] : undefined);
  const equipment = $derived(scene.equipment ?? []);
  const marker = $derived(level.kind === "marker" ? equipment[index] : undefined);
  const places = $derived(scene.carPlaces ?? []);
  const place = $derived(level.kind === "place" ? places[index] : undefined);
  const string = $derived(level.kind === "string" ? draft.strings[index] : undefined);

  const roof = $derived(
    level.kind === "face"
      ? plan.laid.roofs.find((r) => r.block === level.block && r.face === level.face)
      : undefined,
  );

  const loadpoints = $derived(plan.devices.filter(({ profile }) => profile === "evcc"));

  function sceneChange(next: Partial<Draft["scene"]>): void {
    onchange({ ...draft, scene: { ...scene, ...next } });
  }

  /** The draft without this object, back at its group. */
  function remove(next: Draft): void {
    onchange(next);
    onlevel(parent(level));
  }

  // A scene keeps at least one block.
  const removeBlock = $derived(
    scene.blocks.length > 1
      ? () => {
          remove({ ...draft, scene: withoutBlock(scene, index) });
        }
      : undefined,
  );
</script>

{#if block !== undefined}
  <BlockFieldset
    {block}
    onchange={(next) => {
      sceneChange({ blocks: scene.blocks.with(index, next) });
    }}
    onremove={removeBlock}
  />
{:else if obstacle !== undefined}
  <ObstacleFieldset
    item={obstacle}
    onchange={(next) => {
      sceneChange({ obstacles: scene.obstacles.with(index, next) });
    }}
    onremove={() => {
      remove({ ...draft, scene: { ...scene, obstacles: scene.obstacles.toSpliced(index, 1) } });
    }}
  />
{:else if marker !== undefined}
  <EquipmentFieldset
    {marker}
    devices={plan.devices}
    blocks={scene.blocks.length}
    onchange={(next) => {
      sceneChange({ equipment: equipment.with(index, next) });
    }}
    onremove={() => {
      remove({ ...draft, scene: { ...scene, equipment: equipment.toSpliced(index, 1) } });
    }}
  />
{:else if place !== undefined}
  <CarPlaceFieldset
    {place}
    {loadpoints}
    onchange={(next) => {
      sceneChange({ carPlaces: places.with(index, next) });
    }}
    onremove={() => {
      remove({ ...draft, scene: { ...scene, carPlaces: places.toSpliced(index, 1) } });
    }}
  />
{:else if string !== undefined}
  <StringFieldset
    {string}
    position={index}
    made={painted(scene, index)}
    {moduleTypes}
    devices={plan.devices}
    onchange={(next) => {
      onchange({ ...draft, strings: draft.strings.with(index, next) });
    }}
    onremove={() => {
      remove({ scene: withoutString(scene, index), strings: draft.strings.toSpliced(index, 1) });
    }}
  />
{:else if roof !== undefined}
  <FaceLevel {roof} {plan} {moduleTypes} {moduleType} {onchange} />
{/if}
