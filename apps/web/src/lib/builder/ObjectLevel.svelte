<!-- One object's level in the inspector; a face's level is its module-grid editor (ADR 20). -->
<script lang="ts">
  import type { Datasheet, ModuleType, Problem } from "../api/core.ts";
  import BuildingLevel from "./BuildingLevel.svelte";
  import CarPlaceFieldset from "./CarPlaceFieldset.svelte";
  import EquipmentFieldset from "./EquipmentFieldset.svelte";
  import FaceLevel from "./FaceLevel.svelte";
  import { parent, type Level } from "./levels.ts";
  import { painted, withoutString, type Draft, type Strokes } from "./modules.ts";
  import type { Plan } from "./outline.ts";
  import StringFieldset from "./StringFieldset.svelte";
  import SurroundingLevel from "./SurroundingLevel.svelte";

  let {
    level,
    plan,
    moduleTypes,
    addType,
    strokes,
    onchange,
    onlevel,
  }: {
    level: Exclude<Level, { kind: "root" | "section" }>;
    plan: Plan;
    moduleTypes: readonly ModuleType[];
    /** Adds a module type to the core. */
    addType: (datasheet: Readonly<Datasheet>) => Promise<ModuleType | Problem>;
    strokes: Strokes;
    onchange: (draft: Draft) => void;
    onlevel: (level: Level) => void;
  } = $props();

  const draft = $derived(plan.draft);
  const scene = $derived(draft.scene);
  const index = $derived("index" in level ? level.index : -1);

  /** The object the level names, by its kind; undefined for every other kind. */
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

  /** A building or a surrounding object's level: the kinds that edit the scene alone. */
  const building = $derived(level.kind === "block" || level.kind === "chimney" ? level.kind : null);

  const surrounding = $derived(
    level.kind === "obstacle" || level.kind === "surface" || level.kind === "fence"
      ? level.kind
      : null,
  );

  function sceneEdit(next: Draft["scene"]): void {
    onchange({ ...draft, scene: next });
  }

  function sceneRemove(next: Draft["scene"]): void {
    remove({ ...draft, scene: next });
  }

  /** The draft without this object, back at its group. */
  function remove(next: Draft): void {
    onchange(next);
    onlevel(parent(level));
  }
</script>

{#if building !== null}
  <BuildingLevel
    kind={building}
    {index}
    {scene}
    roofs={plan.laid.roofs}
    onchange={sceneEdit}
    onremove={sceneRemove}
  />
{:else if surrounding !== null}
  <SurroundingLevel
    kind={surrounding}
    {index}
    {scene}
    onchange={sceneEdit}
    onremove={sceneRemove}
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
    warning={plan.cold.find((cold) => cold.string === index)?.text}
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
  <FaceLevel {roof} {plan} {moduleTypes} {addType} {strokes} {onchange} />
{/if}
