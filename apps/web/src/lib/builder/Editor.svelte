<!-- The inspector's body at one level (ADR 20): the root groups, a group's rows, or one object. -->
<script lang="ts">
  import type { Datasheet, ModuleType, Problem } from "../api/core.ts";
  import type { Level } from "./levels.ts";
  import type { Draft, Strokes } from "./modules.ts";
  import ObjectLevel from "./ObjectLevel.svelte";
  import type { Plan } from "./outline.ts";
  import RootLevel from "./RootLevel.svelte";
  import SectionLevel from "./SectionLevel.svelte";

  let {
    plan,
    moduleTypes,
    addType,
    level,
    onlevel,
    strokes,
    onchange,
  }: {
    plan: Plan;
    moduleTypes: readonly ModuleType[];
    /** Adds a module type to the core. */
    addType: (datasheet: Readonly<Datasheet>) => Promise<ModuleType | Problem>;
    level: Level;
    onlevel: (level: Level) => void;
    strokes: Strokes;
    onchange: (draft: Draft) => void;
  } = $props();

  /** A new grid's or string's module type: the first one. */
  const moduleType = $derived(moduleTypes[0]?.id);
</script>

{#if level.kind === "root"}
  <RootLevel {plan} {onlevel} />
{:else if level.kind === "section"}
  <SectionLevel section={level.section} {plan} {moduleType} {onchange} {onlevel} />
{:else}
  <ObjectLevel {level} {plan} {moduleTypes} {addType} {strokes} {onchange} {onlevel} />
{/if}
