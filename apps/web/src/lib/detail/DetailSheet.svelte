<!--
  A figure's detail as a glass side sheet (desktop, tablet) or a draggable bottom sheet (phone),
  ADR 21. Its hash route is the caller's: `id` opens it, `onclose` asks to leave it.
-->
<script lang="ts">
  import * as Sheet from "#lib/components/ui/sheet/index.js";
  import type { Core, Live, PvString } from "../api/core.ts";
  import BottomSheet from "../components/bottom-sheet.svelte";
  import { estimatedSeries, layoutStrings } from "../live/plant-facts.ts";
  import { SPOT, type Day } from "../dashboard/day.ts";
  import { RangeRoute, type Go } from "../range/route.svelte.ts";
  import { input } from "../shell/input.svelte.ts";
  import DetailBody from "./DetailBody.svelte";
  import { figure, titleOf } from "./figures.ts";
  import { nodeReadings, type Source } from "./readings.ts";

  let {
    id,
    core,
    live,
    series,
    day,
    names,
    params,
    go,
    onopen,
    onclose,
  }: {
    /** The figure shown; null while closed. */
    id: string | null;
    core: Pick<
      Core,
      "layout" | "capabilities" | "timezone" | "history" | "moduleTypes" | "corrections"
    >;
    live: Live | undefined;
    /** The live stream's last two minutes, for a sheet's live graph. */
    series: Source["series"];
    day: Day | undefined;
    /** Device names, which only the admin may list (ADR 9). */
    names: ReadonlyMap<number, string>;
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

  // The body keeps its last figure while the sheet slides out.
  let last = $state("production");

  $effect(() => {
    if (id !== null && figure(id) !== null) last = id;
  });

  const shown = $derived(id !== null && figure(id) !== null ? id : last);
  const open = $derived(id !== null);
  const spec = $derived(figure(shown) ?? figure("production")!);

  let strings = $state.raw<readonly PvString[]>([]);
  let estimated = $state.raw<Source["estimated"]>({});
  let now = $state(Date.now());

  // Read once a sheet first opens: the dashboard itself needs neither.
  let read = false;

  $effect(() => {
    if (!open || read) return;

    read = true;
    void layoutStrings(core).then((next) => (strings = next));
    void estimatedSeries(core).then((next) => (estimated = next));
  });

  $effect(() => {
    if (!open) return;

    now = Date.now();
    const timer = setInterval(() => (now = Date.now()), TICK_MS);

    return () => clearInterval(timer);
  });

  const status = $derived<Source["status"]>(
    live === undefined ? "loading" : "problem" in live ? "stopped" : "live",
  );

  const values = $derived(live !== undefined && "devices" in live ? live.devices : {});

  const source = $derived<Source>({
    strings,
    values,
    stale: live !== undefined && "devices" in live ? (live.stale ?? {}) : {},
    estimated,
    names: Object.fromEntries(names),
    now,
    status,
    series,
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
      class="glass-ambient w-full gap-0 overflow-y-auto p-0 outline-none no-scrollbar data-[side=right]:sm:max-w-[460px]"
    >
      <Sheet.Title class="sr-only">{title}</Sheet.Title>
      {@render body()}
    </Sheet.Content>
  </Sheet.Root>
{:else}
  <BottomSheet
    bind:open={
      () => open,
      (v) => {
        if (!v) onclose();
      }
    }
    label={title}
  >
    <div class="overflow-y-auto no-scrollbar" data-detail-sheet>
      {@render body()}
    </div>
  </BottomSheet>
{/if}

<style>
  /* A detail sits beside the dashboard it was opened from: the scrim dims it but leaves it
     readable, and no full-screen blur fades in (ADR 21: never animate backdrop-filter). */
  :global(body:has([data-detail-sheet]) [data-slot="sheet-overlay"]) {
    background: color-mix(in oklab, var(--background) 55%, transparent);
    backdrop-filter: none;
    -webkit-backdrop-filter: none;
  }
</style>
