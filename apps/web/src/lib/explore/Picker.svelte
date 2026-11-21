<!--
  The picker (ADR 22): one search over every device, then each device with its series by role
  namespace. A row toggles its series; what is charted is marked. Its shell (pane or drawer) is the
  screen's.
-->
<script lang="ts">
  import Search from "@lucide/svelte/icons/search";
  import { Input } from "#lib/components/ui/input/index.js";
  import LoadFailed from "../components/load-failed.svelte";
  import LoadingRows from "../components/loading-rows.svelte";
  import { m } from "../paraglide/messages.js";
  import type { Explore } from "./explore.svelte.ts";
  import { blocked } from "./lanes.ts";
  import { searched, type PickerSeries } from "./picker.ts";
  import type { SeriesRef } from "./view.ts";
  import PickerGroup from "./PickerGroup.svelte";

  let {
    x,
    onpick,
    search = $bindable(null),
  }: {
    x: Explore;
    /** A row was pressed: the pane toggles its series, the drawer closes on it. */
    onpick: (ref: SeriesRef) => void;
    /** The search field, which "Add series" focuses beside an open pane. */
    search?: HTMLInputElement | null;
  } = $props();

  const uid = $props.id();

  let query = $state("");

  const found = $derived(searched(x.devices, query));

  /** Why the chart takes no further series, or only those of the lanes it has (ADR 22). */
  const full = $derived(
    blocked(x.chosen, { kind: null, unit: null }) === "series"
      ? m.explore_full_series()
      : x.devices.some((d) => d.groups.some((g) => g.series.some(barred)))
        ? m.explore_full_lanes()
        : null,
  );

  function barred(series: PickerSeries): boolean {
    return !x.isChosen(series.ref) && blocked(x.chosen, series) !== null;
  }
</script>

<div class="px-3 pt-3 pb-2">
  <div class="relative">
    <Search
      class="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
    />
    <Input
      bind:ref={search}
      type="search"
      autocomplete="off"
      enterkeyhint="search"
      aria-label={m.explore_search()}
      placeholder={m.explore_search()}
      class="pl-8"
      bind:value={query}
    />
  </div>
</div>

<p role="status" class="px-4 pb-2 text-xs text-muted-foreground empty:hidden">{full}</p>

<div class="min-h-0 flex-1 overflow-y-auto pb-2 scroll-fade-y no-scrollbar">
  {#if x.catalog === "loading"}
    <LoadingRows rows={5} />
  {:else if x.catalog === "failed"}
    <LoadFailed
      class="px-4"
      text={m.explore_catalog_error()}
      refused={x.refused}
      onretry={() => void x.load()} />
  {:else if found.length === 0}
    <p class="px-4 py-6 text-center text-sm text-muted-foreground">
      {query.trim() === "" ? m.explore_catalog_empty() : m.explore_no_match({ query: query.trim() })}
    </p>
  {/if}
  {#each found as device (device.id)}
    <section aria-labelledby="{uid}-{device.id}" class="pt-3">
      <h3
        id="{uid}-{device.id}"
        class="flex items-baseline gap-2 px-4 pb-1 text-sm font-semibold"
      >
        <span class="min-w-0 truncate">{device.name}</span>
        {#if device.removed}
          <span class="text-xs font-normal text-muted-foreground">{m.explore_removed()}</span>
        {/if}
      </h3>
      {#each device.groups as group (group.id)}
        <!-- A device of one namespace that is its own name, such as the weather, says it once. -->
        <PickerGroup
          {group}
          untitled={group.title === device.name}
          chosen={x.isChosen}
          full={barred}
          {onpick}
        />
      {/each}
    </section>
  {/each}
</div>
