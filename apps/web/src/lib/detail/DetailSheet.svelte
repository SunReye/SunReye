<!--
  A figure's detail as a glass side sheet (desktop, tablet) or a draggable bottom sheet (phone),
  ADR 21. Its hash route is the caller's: `id` opens it, `onclose` asks to leave it.
-->
<script lang="ts">
  import * as Sheet from "#lib/components/ui/sheet/index.js";
  import { SPOT, TARIFF, type Core, type Live, type PvString } from "../api/core.ts";
  import DrawerSheet from "../components/drawer-sheet.svelte";
  import {
    estimatedSeries,
    layoutStrings,
    storedSeries,
    type Stored,
  } from "../live/plant-facts.ts";
  import type { Day } from "../dashboard/day.ts";
  import { RangeRoute, type Go } from "../range/route.svelte.ts";
  import { input } from "../shell/input.svelte.ts";
  import DetailBody from "./DetailBody.svelte";
  import { figure, titleOf } from "./figures.ts";
  import { exploreLinks, nodeReadings, type Source } from "./readings.ts";

  let {
    id,
    core,
    live,
    series,
    day,
    names,
    admin,
    params,
    go,
    onopen,
    onclose,
  }: {
    /** The figure shown; null while closed. */
    id: string | null;
    core: Pick<
      Core,
      | "layout"
      | "capabilities"
      | "timezone"
      | "statistics"
      | "forecasts"
      | "moduleTypes"
      | "corrections"
      | "topology"
      | "series"
      | "history"
      | "costs"
      | "payback"
    >;
    live: Live | undefined;
    /** The live stream's last two minutes, for a sheet's live graph. */
    series: Source["series"];
    day: Day | undefined;
    /** Device names, which only the admin may list (ADR 9). */
    names: ReadonlyMap<number, string>;
    admin: boolean;
    /** The hash route's query: the sheet's range sits beside its figure. */
    params: URLSearchParams;
    go: Go;
    onopen: (id: string) => void;
    onclose: () => void;
  } = $props();

  // A sheet opens on its day: the range is its own, and "Open in history" carries it over.
  const sheetParams = $derived.by(() => {
    if (params.has("range")) return params;

    const own = new URLSearchParams(params);

    own.set("range", "day");

    return own;
  });

  const route = new RangeRoute(() => ({ params: sheetParams, go, core }));

  /** How often stale ages are recounted while a sheet is open. */
  const TICK_MS = 5000;

  // The body keeps its last figure while the sheet slides out. A plain memory, not state: only the
  // derived reads it.
  let last = "production";

  const shown = $derived.by(() => {
    if (id !== null && figure(id) !== null) last = id;

    return last;
  });

  const open = $derived(id !== null);
  const spec = $derived(figure(shown) ?? figure("production")!);

  let strings = $state.raw<readonly PvString[]>([]);
  let estimated = $state.raw<Source["estimated"]>({});

  /** The topology's points, which viewers read too (ADR 9, 14). */
  let points = $state.raw<Source["points"]>([]);

  /** The series with stored history by `device/series` (ADR 22); null until the catalog is read. */
  let stored = $state.raw<ReadonlyMap<string, Stored> | null>(null);

  let now = $state(Date.now());

  // Read once a sheet first opens: the dashboard itself needs neither.
  let read = false;

  $effect(() => {
    if (!open || read) return;

    read = true;
    void layoutStrings(core).then((next) => (strings = next));
    void estimatedSeries(core).then((next) => (estimated = next));
    void core
      .topology()
      .then((next) => {
        if ("points" in next) points = next.points;

        return null;
      })
      .catch(() => null);
    void storedSeries(core).then((next) => (stored = next));
  });

  $effect(() => {
    if (!open) return;

    now = Date.now();
    const timer = setInterval(() => (now = Date.now()), TICK_MS);

    return () => clearInterval(timer);
  });

  // A lost stream reads like a refused one: its last values stay, dimmed, under one notice.
  const status = $derived<Source["status"]>(
    live === undefined
      ? "loading"
      : "problem" in live || live.lost !== undefined
        ? "stopped"
        : "live",
  );

  const values = $derived(live !== undefined && "devices" in live ? live.devices : {});

  // The tariff publishes its prices while one is in force (ADR 12). Only a stream that answered
  // with its devices says none is: one not yet read or refused says nothing.
  const priced = $derived(
    live === undefined || !("devices" in live) || values[TARIFF]?.["price.import"] !== undefined,
  );

  const source = $derived<Source>({
    strings,
    values,
    stale: live !== undefined && "devices" in live ? (live.stale ?? {}) : {},
    estimated,
    names: Object.fromEntries(names),
    points,
    now,
    status,
    series,
    link: exploreLinks(stored ?? new Set(), route.rangeParams),
  });

  const node = $derived(spec.node === null ? null : nodeReadings(spec.node, source));

  const title = $derived(titleOf(shown, strings, (device) => names.get(device)));

  const side = $derived(input.shell !== "bar");
</script>

{#snippet body()}
  <DetailBody
    id={shown}
    {title}
    {spec}
    {node}
    {status}
    {day}
    spot={values[SPOT]}
    input={{ core, route, strings }}
    record={stored}
    {priced}
    {admin}
    {onopen}
  />
{/snippet}

{#if side}
  <Sheet.Root {open} onOpenChange={(o) => !o && onclose()}>
    <Sheet.Content
      side="right"
      data-detail-sheet
      tabindex={-1}
      onOpenAutoFocus={(e) => {
        // Focus the sheet, not its first control: a mouse open should not paint a focus ring.
        e.preventDefault();
        (document.querySelector("[data-detail-sheet]") as HTMLElement | null)?.focus();
      }}
      class="glass-ambient w-full gap-0 overflow-hidden p-0 outline-none data-[side=right]:sm:max-w-[460px]"
    >
      <Sheet.Title class="sr-only">{title}</Sheet.Title>
      <!-- The glass keeps its edge; the sheet scrolls and fades inside it (ADR 21). -->
      <div class="min-h-0 flex-1 overflow-y-auto scroll-fade-y no-scrollbar">
        {@render body()}
      </div>
    </Sheet.Content>
  </Sheet.Root>
{:else}
  <DrawerSheet
    bind:open={
      () => open,
      (v) => {
        if (!v) onclose();
      }
    }
    label={title}
  >
    <div class="overflow-y-auto scroll-fade-y no-scrollbar" data-detail-sheet>
      {@render body()}
    </div>
  </DrawerSheet>
{/if}

<style>
  /* A detail sits beside the dashboard it was opened from: the scrim dims it but leaves it
     readable, and no full-screen blur fades in (ADR 21: never animate backdrop-filter). */
  :global(body:has([data-detail-sheet]) [data-slot="sheet-overlay"]) {
    background: color-mix(in oklab, var(--background) 55%, transparent);
    -webkit-backdrop-filter: none;
    backdrop-filter: none;
  }
</style>
