<!--
  Setup's measurement points (ADR 14), confirm first: the tree proposed from the readings, each point
  with its live power and the remainder no point measures. One tap accepts it; "Anpassen" lets a point
  be renamed, moved through a sheet, removed, or added back.
-->
<script lang="ts">
  import LoaderCircle from "@lucide/svelte/icons/loader-circle";
  import type { Core, Device, PointDraft, Problem } from "../api/core.ts";
  import { m } from "../paraglide/messages.js";
  import AddSheet from "./AddSheet.svelte";
  import PointSheet from "./PointSheet.svelte";
  import PointTree from "./PointTree.svelte";
  import TopologyActions from "./TopologyActions.svelte";
  import { Readings } from "./readings.svelte.ts";
  import { move, remove } from "./topology.ts";
  import { answered, confirmed } from "../feedback.ts";

  let { core, devices, ondone }: { core: Core; devices: readonly Device[]; ondone: () => void } =
    $props();

  const readings = new Readings(() => core);

  /** The tree held still while it is adjusted; until then the proposal follows the readings. */
  let edited = $state.raw<readonly PointDraft[]>();

  let adjusting = $state(false);

  /** The open point, by its claims: a move reorders the points. */
  let picked = $state.raw<PointDraft["claims"]>();

  let sheet = $state(false);

  let refused = $state.raw<Problem>();

  const points = $derived(edited ?? readings.proposed(devices));

  const unclaimed = $derived(points === undefined ? [] : readings.left(points, devices));

  const index = $derived(points?.findIndex(({ claims }) => claims === picked) ?? -1);

  function adjust(): void {
    edited = points;
    adjusting = true;
  }

  function open(at: number): void {
    picked = points?.[at]?.claims;
    sheet = true;
  }

  function rename(name: string): void {
    const point = points?.[index];

    if (points !== undefined && point !== undefined)
      edited = points.with(index, { ...point, name });
  }

  async function save(): Promise<void> {
    const saved = await core.changeTopology({
      appliesFrom: new Date().toISOString(),
      points: [...(points ?? [])],
    });

    refused = "problem" in saved ? answered(saved) : undefined;

    if (refused === undefined) {
      confirmed(m.settings_saved());
      ondone();
    }
  }
</script>

<div class="flex flex-col gap-4 p-4">
  <p class="text-sm text-muted-foreground">
    {adjusting ? m.topology_adjust_hint() : m.topology_hint()}
  </p>
  {#if points === undefined}
    <p role="status" class="flex items-center gap-2 text-sm text-muted-foreground">
      <LoaderCircle class="size-4 motion-safe:animate-spin" />
      {m.topology_waiting()}
    </p>
  {/if}
</div>
{#if points !== undefined && readings.values !== undefined}
  <div class="border-y border-border/60 py-1">
    <PointTree {points} values={readings.values} {devices} onedit={adjusting ? open : undefined} />
    {#if adjusting}
      <AddSheet
        points={unclaimed}
        {devices}
        onadd={(point) => {
          edited = [...points, point];
        }}
      />
    {/if}
  </div>
  <TopologyActions
    {adjusting}
    {refused}
    onaccept={save}
    onadjust={adjust}
    onreset={() => {
      edited = undefined;
      adjusting = false;
    }}
  />
  <PointSheet
    bind:open={sheet}
    {points}
    {index}
    onrename={rename}
    onmove={(parent) => {
      edited = move(points, index, parent);
    }}
    onremove={() => {
      edited = remove(points, index);
    }}
  />
{/if}
