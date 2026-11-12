<script lang="ts">
  import ArrowRight from "@lucide/svelte/icons/arrow-right";
  import { DETAILS } from "./details";
  import { SPOT, type LiveSim } from "./sim.svelte";
  import DayChart from "./DayChart.svelte";
  import RangeControl from "./RangeControl.svelte";
  import { Button } from "#lib/components/ui/button/index.js";
  import * as Card from "#lib/components/ui/card/index.js";
  import * as Tabs from "#lib/components/ui/tabs/index.js";
  import { haptics } from "./haptics";

  let { id, sim, onhistory }: { id: string; sim: LiveSim; onhistory: () => void } = $props();
  const spec = $derived(DETAILS[id] ?? DETAILS.production!);
  let range = $state<"Tag" | "Woche" | "Monat" | "Jahr" | "Frei">("Tag");
  let tab = $state("Übersicht");
  const spotMax = Math.max(...SPOT);
  const heat = Array.from({ length: 7 * 24 }, (_, i) => {
    const h = i % 24;
    return Math.max(0, Math.sin(((h - 5.5) / 15.5) * Math.PI)) ** 1.6 * (0.6 + 0.4 * Math.abs(Math.sin(i * 1.7)));
  });
</script>

<div class="flex flex-col gap-4">
  <div class="flex flex-col gap-1">
    <span class="flex items-center gap-1.5 text-xs font-medium text-muted-foreground"><span class="size-1.5 rounded-full" style:background={spec.colour}></span>Detail</span>
    <h2 class="text-xl font-semibold tracking-tight">{spec.title}</h2>
  </div>

  <RangeControl bind:range />

  <Tabs.Root bind:value={() => tab, (v: string) => {
    if (v !== tab) haptics.selection();
    tab = v;
  }}>
    <Tabs.List variant="line">
      {#each ["Übersicht", "Heatmap", "Vergleich"] as t (t)}
        <Tabs.Trigger value={t}>{t}</Tabs.Trigger>
      {/each}
    </Tabs.List>
    <Tabs.Content value="Übersicht">
      <Card.Root size="sm" class="glass-ambient px-3">
        {#if spec.metric === "price"}
          <div class="flex h-[200px] items-end gap-[3px] pt-2">
            {#each SPOT as p, h (h)}
              <span class={["flex-1 rounded-sm", h === 15 ? "bg-foreground" : "bg-foreground/25"]} style:height="{(p / spotMax) * 100}%"></span>
            {/each}
          </div>
        {:else}
          <DayChart data={sim.day} height={220} metric={spec.metric} />
        {/if}
      </Card.Root>
    </Tabs.Content>
    <Tabs.Content value="Heatmap">
      <Card.Root size="sm" class="glass-ambient px-3">
        <div class="grid gap-[2px]" style:grid-template-columns="repeat(24, minmax(0, 1fr))">
          {#each heat as v, i (i)}
            <span class="aspect-square rounded-sm" style:background="color-mix(in oklab, {spec.colour} {Math.round(v * 100)}%, transparent)"></span>
          {/each}
        </div>
      </Card.Root>
    </Tabs.Content>
    <Tabs.Content value="Vergleich">
      <Card.Root size="sm" class="glass-ambient px-6 py-6 text-center text-sm text-muted-foreground">String-Vergleich (Platzhalter)</Card.Root>
    </Tabs.Content>
  </Tabs.Root>

  <Card.Root size="sm" class="glass-ambient py-0">
    <dl class="grid grid-cols-3 divide-x divide-border/60">
      {#each spec.stats as [k, v] (k)}
        <div class="flex flex-col gap-0.5 px-3 py-2.5">
          <dt class="text-[11px] text-muted-foreground">{k}</dt>
          <dd class="text-sm font-semibold tabular-nums">{v}</dd>
        </div>
      {/each}
    </dl>
  </Card.Root>

  <Button variant="outline" size="lg" class="self-start" onclick={onhistory}>
    Im Verlauf öffnen <ArrowRight data-icon="inline-end" class="transition-transform group-hover/button:translate-x-0.5" />
  </Button>
</div>
