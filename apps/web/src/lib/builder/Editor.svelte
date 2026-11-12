<!-- The inspector's body at one level (ADR 20): the root groups, a group's rows, or one object. -->
<script lang="ts">
  import type { ModuleType } from "../api/core.ts";
  import type { Level } from "./levels.ts";
  import type { Draft } from "./modules.ts";
  import ObjectLevel from "./ObjectLevel.svelte";
  import type { Plan } from "./outline.ts";
  import RootLevel from "./RootLevel.svelte";
  import SectionLevel from "./SectionLevel.svelte";

  let {
    plan,
    moduleTypes,
    level,
    onlevel,
    onchange,
  }: {
    plan: Plan;
    moduleTypes: readonly ModuleType[];
    level: Level;
    onlevel: (level: Level) => void;
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
  <ObjectLevel {level} {plan} {moduleTypes} {moduleType} {onchange} {onlevel} />
{/if}
