<!-- PROTOTYPE: the one range control of detail pages (ADR 21): day … custom, arrows step. -->
<script lang="ts">
  import ChevronLeft from "@lucide/svelte/icons/chevron-left";
  import ChevronRight from "@lucide/svelte/icons/chevron-right";
  import * as ToggleGroup from "#lib/components/ui/toggle-group/index.js";
  import { Button } from "#lib/components/ui/button/index.js";
  import { haptics } from "./haptics";

  const RANGES = ["Tag", "Woche", "Monat", "Jahr", "Frei"] as const;
  type Range = (typeof RANGES)[number];
  let { range = $bindable("Tag"), offset = $bindable(0) }: { range?: Range; offset?: number } = $props();

  const label = $derived.by(() => {
    const d = new Date();
    if (range === "Tag") {
      d.setDate(d.getDate() + offset);
      return offset === 0 ? "Heute" : offset === -1 ? "Gestern" : new Intl.DateTimeFormat("de-DE", { weekday: "short", day: "numeric", month: "short" }).format(d);
    }
    if (range === "Woche") return offset === 0 ? "Diese Woche" : `KW ${46 + offset}`;
    if (range === "Monat") {
      d.setMonth(d.getMonth() + offset);
      return new Intl.DateTimeFormat("de-DE", { month: "long", year: "numeric" }).format(d);
    }
    if (range === "Jahr") return String(d.getFullYear() + offset);
    return "1. – 10. Nov.";
  });
</script>

<div class="flex flex-wrap items-center gap-2">
  <ToggleGroup.Root
    type="single"
    variant="outline"
    size="sm"
    bind:value={() => range, (v: string) => {
      if (!v || v === range) return;
      haptics.selection();
      range = v as Range;
      offset = 0;
    }}
    aria-label="Zeitraum"
  >
    {#each RANGES as r (r)}
      <ToggleGroup.Item value={r} class="text-xs">{r}</ToggleGroup.Item>
    {/each}
  </ToggleGroup.Root>
  <div class="ml-auto flex items-center gap-1">
    <Button variant="ghost" size="icon-sm" aria-label="Zurück" onclick={() => offset--}><ChevronLeft /></Button>
    <span class="min-w-[92px] text-center text-xs font-medium tabular-nums">{label}</span>
    <Button variant="ghost" size="icon-sm" aria-label="Weiter" disabled={offset >= 0} onclick={() => offset++}><ChevronRight /></Button>
  </div>
</div>
