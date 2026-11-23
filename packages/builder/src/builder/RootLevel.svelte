<!-- The inspector's root (ADR 20): its five groups, each summarising what it holds. -->
<script lang="ts">
  import Cable from "@lucide/svelte/icons/cable";
  import House from "@lucide/svelte/icons/house";
  import LayoutGrid from "@lucide/svelte/icons/layout-grid";
  import PlugZap from "@lucide/svelte/icons/plug-zap";
  import Trees from "@lucide/svelte/icons/trees";
  import * as Item from "@sunreye/ui/item";
  import DrillRow from "../components/drill-in/drill-row.svelte";
  import type { Level, Section } from "./levels.ts";
  import { SECTIONS, summary, type Plan } from "./outline.ts";

  let { plan, onlevel }: { plan: Plan; onlevel: (level: Level) => void } = $props();

  const ROOT = [
    ["buildings", House],
    ["surroundings", Trees],
    ["equipment", PlugZap],
    ["modules", LayoutGrid],
    ["strings", Cable],
  ] as const satisfies readonly (readonly [Section, unknown])[];
</script>

<Item.Group class="gap-0 divide-y divide-border/60">
  {#each ROOT as [section, icon] (section)}
    <DrillRow
      group={{ id: section, label: SECTIONS[section](), summary: summary(section, plan), icon }}
      onclick={() => {
        onlevel({ kind: "section", section });
      }}
    />
  {/each}
</Item.Group>
