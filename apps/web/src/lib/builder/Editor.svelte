<!-- The inspector's body at one level (ADR 20): the root groups, a group's rows, or one object. -->
<script lang="ts">
  import type { ModuleType } from "../api/core.ts";
  import type { Level } from "./levels.ts";
  import type { Draft, TypeSource } from "./modules.ts";
  import ObjectLevel from "./ObjectLevel.svelte";
  import type { Plan } from "./outline.ts";
  import { removal } from "./removal.ts";
  import RootLevel from "./RootLevel.svelte";
  import SectionLevel from "./SectionLevel.svelte";

  let {
    plan,
    moduleTypes,
    types,
    level,
    onlevel,
    onchange,
  }: {
    plan: Plan;
    moduleTypes: readonly ModuleType[];
    /** Adds module types to the core, and its catalogue to add them from. */
    types: TypeSource;
    level: Level;
    onlevel: (level: Level) => void;
    onchange: (draft: Draft) => void;
  } = $props();

  /** A new grid's or string's module type: the first one. */
  const moduleType = $derived(moduleTypes[0]?.id);

  function remove(): void {
    const gone = removal(plan.draft, level);

    if (gone === null) return;

    onchange(gone.draft);
    onlevel(gone.level);
  }
</script>

{#if level.kind === "root"}
  <RootLevel {plan} {onlevel} />
{:else if level.kind === "section"}
  <SectionLevel section={level.section} {plan} {moduleType} {onchange} {onlevel} />
{:else}
  <ObjectLevel {level} {plan} {moduleTypes} {types} {onchange} {onlevel} onremove={remove} />
{/if}
