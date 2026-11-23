<!-- An inspector group: a row per object drilling to it, and the objects it can add. -->
<script lang="ts">
  import * as Item from "@sunreye/ui/item";
  import DrillRow from "../components/drill-in/drill-row.svelte";
  import { m } from "../paraglide/messages.js";
  import AddButtons from "./AddButtons.svelte";
  import { additions } from "./additions.ts";
  import { degrees } from "./fields.ts";
  import type { Level, Section } from "@sunreye/builder/builder/levels.ts";
  import type { Draft } from "@sunreye/builder/builder/modules.ts";
  import { entries, placed, type Plan } from "./outline.ts";
  import ValueRow from "./ValueRow.svelte";

  let {
    section,
    plan,
    moduleType,
    onchange,
    onlevel,
  }: {
    section: Section;
    plan: Plan;
    /** A new string's, when no grid names one; without either no string is added. */
    moduleType: number | undefined;
    onchange: (draft: Draft) => void;
    onlevel: (level: Level) => void;
  } = $props();

  const rows = $derived(entries(section, plan));
  const adds = $derived(additions(section, plan, moduleType));
  const unassigned = $derived(placed(plan.draft).unassigned);

  const compass = degrees(m.builder_compass(), 0, 359);
</script>

<Item.Group class="gap-0 divide-y divide-border/60">
  {#if section === "surroundings"}
    <ValueRow
      edit={compass}
      value={plan.draft.scene.north}
      onchange={(north) => {
        onchange({ ...plan.draft, scene: { ...plan.draft.scene, north } });
      }}
    />
  {/if}
  {#each rows as row (JSON.stringify(row.level))}
    <DrillRow
      group={{ id: JSON.stringify(row.level), label: row.label, summary: row.summary }}
      onclick={() => {
        onlevel(row.level);
      }}
    />
  {/each}
</Item.Group>

{#if section === "modules" && moduleType === undefined}
  <p class="px-4 py-3 text-sm text-muted-foreground">{m.builder_no_module_types()}</p>
{/if}
{#if section === "modules" && unassigned > 0}
  <p class="px-4 py-3 text-sm text-muted-foreground">
    {m.builder_unassigned({ count: unassigned })}
  </p>
{/if}

<AddButtons {adds} {onchange} {onlevel} />
