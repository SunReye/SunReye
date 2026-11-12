<!--
  PROTOTYPE: the one range control (ADR 21), shared by detail sheets and the Statistics screen:
  day … custom, arrows or a swipe on the label step. It holds no state: the caller owns the range.
-->
<script lang="ts">
  import ChevronLeft from "@lucide/svelte/icons/chevron-left";
  import ChevronRight from "@lucide/svelte/icons/chevron-right";
  import * as ToggleGroup from "#lib/components/ui/toggle-group/index.js";
  import { Button } from "#lib/components/ui/button/index.js";
  import { Input } from "#lib/components/ui/input/index.js";
  import { haptics } from "./haptics";
  import { swipe } from "./stats/swipe";
  import { indicator } from "./stats/indicator";
  import Pager from "./stats/Pager.svelte";
  import type { Kind } from "./stats/query";

  const KINDS: [Kind, string][] = [["day", "Tag"], ["week", "Woche"], ["month", "Monat"], ["year", "Jahr"], ["custom", "Frei"]];

  let {
    kind,
    label,
    dir,
    canPrev = true,
    canNext = false,
    onkind,
    onstep,
    custom,
  }: {
    kind: Kind;
    label: string;
    /** Which way the last change of range went; the label rolls that way. Left out, the arrows decide. */
    dir?: -1 | 0 | 1 | undefined;
    canPrev?: boolean;
    canNext?: boolean;
    onkind: (kind: Kind) => void;
    onstep: (dir: -1 | 1) => void;
    /** The custom range's two dates and hours, shown while it is chosen. `toHour` 24 is the end of the day. */
    custom?: {
      from: string;
      to: string;
      fromHour: number;
      toHour: number;
      min: string;
      max: string;
      onchange: (from: string, to: string, fromHour: number, toHour: number) => void;
      onall: () => void;
    };
  } = $props();

  let went: -1 | 0 | 1 = 0;
  function stepBy(to: -1 | 1): void {
    if (to < 0 ? !canPrev : !canNext) return;
    haptics.selection();
    went = to;
    onstep(to);
  }
  function roll(): { kind: "shift"; dir: -1 | 0 | 1 } {
    const way = dir ?? went;
    went = 0;
    return { kind: "shift", dir: way };
  }

  const HOURS = Array.from({ length: 25 }, (_, i) => i);
  const select =
    "h-8 rounded-md border border-input bg-transparent px-1.5 text-xs tabular-nums outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-input/30";
</script>

{#snippet bound(text: string, end: boolean, c: NonNullable<typeof custom>)}
  <div class="flex items-center gap-1.5">
    <span class="w-6 text-muted-foreground">{text}</span>
    <Input
      type="date"
      class="h-8 w-[9.5rem] text-xs"
      aria-label="{text} Datum"
      value={end ? c.to : c.from}
      min={end ? c.from : c.min}
      max={end ? c.max : c.to}
      onchange={(e) => {
        const v = e.currentTarget.value;
        if (v) c.onchange(end ? c.from : v, end ? v : c.to, c.fromHour, c.toHour);
      }}
    />
    <select
      class={select}
      aria-label="{text} Uhrzeit"
      value={end ? c.toHour : c.fromHour}
      onchange={(e) => {
        const v = +e.currentTarget.value;
        c.onchange(c.from, c.to, end ? c.fromHour : v, end ? v : c.toHour);
      }}
    >
      {#each end ? HOURS.slice(1) : HOURS.slice(0, 24) as hr (hr)}
        <option value={hr}>{hr} Uhr</option>
      {/each}
    </select>
  </div>
{/snippet}

<!-- One row where it fits; below that the stepper takes its own full-width row, arrows at the ends. -->
<div class="@container flex flex-col gap-2">
  <div class="flex flex-col gap-2 @[430px]:flex-row @[430px]:items-center @[430px]:justify-center @[430px]:gap-3">
    <ToggleGroup.Root
      type="single"
      variant="outline"
      size="sm"
      class="grid w-full grid-cols-5 data-indicator:before:hidden! @[430px]:flex @[430px]:w-fit"
      bind:value={() => kind, (v: string) => {
        if (!v || v === kind) return;
        haptics.selection();
        onkind(v as Kind);
      }}
      aria-label="Zeitraum"
    >
      <!-- kbase's sliding pill, on a transform. -->
      <span class="rounded-[2px] bg-foreground/[0.13]" {@attach indicator('[data-state="on"]')}></span>
      {#each KINDS as [id, text] (id)}
        <ToggleGroup.Item value={id} class="px-2.5 text-xs">{text}</ToggleGroup.Item>
      {/each}
    </ToggleGroup.Root>
    <div class="flex items-center justify-between gap-1" {@attach swipe(stepBy)}>
      <Button variant="ghost" size="icon-sm" class="pointer-coarse:size-10" aria-label="Früher" disabled={!canPrev} onclick={() => stepBy(-1)}><ChevronLeft /></Button>
      <div class="min-w-[92px] text-center text-xs font-medium whitespace-nowrap tabular-nums" aria-live="polite">
        <Pager id={label} data={label} travel={roll} after={60}>
          {#snippet children(text)}{text}{/snippet}
        </Pager>
      </div>
      <Button variant="ghost" size="icon-sm" class="pointer-coarse:size-10" aria-label="Später" disabled={!canNext} onclick={() => stepBy(1)}><ChevronRight /></Button>
    </div>
  </div>
  {#if kind === "custom" && custom}
    <div class="flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-xs">
      {@render bound("Von", false, custom)}
      {@render bound("Bis", true, custom)}
      <Button variant="ghost" size="sm" class="h-8 text-xs" onclick={custom.onall}>Gesamte Aufzeichnung</Button>
    </div>
  {/if}
</div>
