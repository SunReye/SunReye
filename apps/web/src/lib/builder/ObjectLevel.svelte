<!-- One object's level in the inspector; a face's level is its module-grid editor (ADR 20). -->
<script lang="ts">
  import type { ModuleType } from "../api/core.ts";
  import BuildingLevel from "./BuildingLevel.svelte";
  import CarPlaceFieldset from "./CarPlaceFieldset.svelte";
  import EquipmentFieldset from "./EquipmentFieldset.svelte";
  import FaceLevel from "./FaceLevel.svelte";
  import type { Level } from "./levels.ts";
  import { painted, type Draft, type TypeSource } from "./modules.ts";
  import type { Plan } from "./outline.ts";
  import StringFieldset from "./StringFieldset.svelte";
  import SurroundingLevel from "./SurroundingLevel.svelte";

  let {
    level,
    plan,
    moduleTypes,
    types,
    onchange,
    onlevel,
    onremove,
  }: {
    level: Exclude<Level, { kind: "root" | "section" }>;
    plan: Plan;
    moduleTypes: readonly ModuleType[];
    /** Adds module types to the core, and its catalogue to add them from. */
    types: TypeSource;
    onchange: (draft: Draft) => void;
    onlevel: (level: Level) => void;
    /** Takes the level's object out of the draft and shows its group. */
    onremove: () => void;
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

  /** Where the string leaves its inverter's limits, and the inputs that inverter has. */
  const warnings = $derived(
    [...plan.cold, ...plan.sized].flatMap((warned) => (warned.string === index ? [warned.text] : [])),
  );

  const inputs = $derived(string && plan.inputs[string.device]);

  const roof = $derived(
    level.kind === "face" || level.kind === "module"
      ? plan.laid.roofs.find((r) => r.block === level.block && r.face === level.face)
      : undefined,
  );

  /** A module of the face, tapped in 3D. */
  const tapped = $derived(level.kind === "module" ? level : undefined);

  const loadpoints = $derived(plan.devices.filter(({ profile }) => profile === "evcc"));

  function sceneChange(next: Partial<Draft["scene"]>): void {
    onchange({ ...draft, scene: { ...scene, ...next } });
  }

  /** A scene with one opening more: recorded, and its last opening picked. */
  function added(next: Draft["scene"]): void {
    sceneEdit(next);
    onlevel({ kind: "opening", index: (next.openings?.length ?? 1) - 1 });
  }

  /** A building or a surrounding object's level: the kinds that edit the scene alone. */
  const building = $derived(
    level.kind === "block" ||
      level.kind === "chimney" ||
      level.kind === "roofWindow" ||
      level.kind === "opening"
      ? level.kind
      : null,
  );

  const surrounding = $derived(
    level.kind === "obstacle" || level.kind === "surface" || level.kind === "fence"
      ? level.kind
      : null,
  );

  function sceneEdit(next: Draft["scene"]): void {
    onchange({ ...draft, scene: next });
  }

</script>

{#if building !== null}
  <BuildingLevel
    kind={building}
    {index}
    {scene}
    roofs={plan.laid.roofs}
    pv={plan.pv}
    onchange={sceneEdit}
    onadd={added}
    {onremove}
  />
{:else if surrounding !== null}
  <SurroundingLevel
    kind={surrounding}
    {index}
    {scene}
    onchange={sceneEdit}
    {onremove}
  />
{:else if marker !== undefined}
  <EquipmentFieldset
    {marker}
    devices={plan.devices}
    blocks={scene.blocks.length}
    onchange={(next) => {
      sceneChange({ equipment: equipment.with(index, next) });
    }}
    {onremove}
  />
{:else if place !== undefined}
  <CarPlaceFieldset
    {place}
    {loadpoints}
    onchange={(next) => {
      sceneChange({ carPlaces: places.with(index, next) });
    }}
    {onremove}
  />
{:else if string !== undefined}
  <StringFieldset
    {string}
    position={index}
    made={painted(scene, index)}
    {warnings}
    refused={plan.refused?.string === index ? plan.refused.text : undefined}
    {moduleTypes}
    devices={plan.devices}
    inputs={inputs?.length}
    onchange={(next) => {
      onchange({ ...draft, strings: draft.strings.with(index, next) });
    }}
    {onremove}
  />
{:else if roof !== undefined}
  <FaceLevel
    {roof}
    module={tapped}
    {plan}
    {moduleTypes}
    {types}
    {onchange}
    {onremove}
  />
{/if}
