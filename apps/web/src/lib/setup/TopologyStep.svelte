<!-- Setup's measurement points (ADR 14): the tree proposed from the readings, to rename, re-hang or trim. -->
<script lang="ts">
  import LoaderCircle from "@lucide/svelte/icons/loader-circle";
  import type { Core, Device, PointDraft, Problem, Values } from "../api/core.ts";
  import { Button } from "#lib/components/ui/button/index.js";
  import { m } from "../paraglide/messages.js";
  import PointRow from "./PointRow.svelte";
  import Refusal from "./Refusal.svelte";
  import { depths, propose, remove } from "./topology.ts";

  let { core, devices, ondone }: { core: Core; devices: readonly Device[]; ondone: () => void } =
    $props();

  const ROLES = new Map([
    ["pv.power", m.role_pv],
    ["generator.power", m.role_generator],
    ["battery.power", m.role_battery],
    ["load.power", m.role_load],
    ["backup.power", m.role_backup],
    ["ev.charge.power", m.role_ev],
  ]);

  function label(role: string): string {
    return ROLES.get(role)?.() ?? role;
  }

  let values = $state.raw<Values>();

  /** The admin's tree once they changed the proposal; until then the proposal follows the readings. */
  let edited = $state.raw<readonly PointDraft[]>();

  let refused = $state.raw<Problem>();

  const points = $derived(
    edited ??
      (values === undefined ? undefined : propose(devices, values, m.topology_root(), label)),
  );

  $effect(() =>
    core.live((live) => {
      if (!("problem" in live)) values = live;
    }),
  );

  function change(index: number, point: Readonly<Partial<PointDraft>>): void {
    const at = points?.[index];

    if (points !== undefined && at !== undefined) edited = points.with(index, { ...at, ...point });
  }

  async function save(): Promise<void> {
    const saved = await core.changeTopology({
      appliesFrom: new Date().toISOString(),
      points: [...(points ?? [])],
    });

    refused = "problem" in saved ? saved : undefined;

    if (refused === undefined) ondone();
  }
</script>

<div class="flex flex-col gap-4 p-4">
  <p class="text-sm text-muted-foreground">{m.topology_hint()}</p>
  {#if points === undefined}
    <p role="status" class="flex items-center gap-2 text-sm text-muted-foreground">
      <LoaderCircle class="size-4 motion-safe:animate-spin" />
      {m.topology_waiting()}
    </p>
  {/if}
</div>
{#if points !== undefined}
  {@const depth = depths(points)}
  <ol class="divide-y divide-border/60 border-y border-border/60">
    {#each points as point, index (index)}
      <PointRow
        {point}
        number={index + 1}
        depth={depth[index] ?? 0}
        earlier={points.slice(0, index)}
        onchange={(next) => {
          change(index, next);
        }}
        onremove={() => {
          edited = remove(points, index);
        }}
      />
    {/each}
  </ol>
  <div class="flex flex-col gap-3 p-4">
    <Refusal {refused} />
    <Button class="w-full sm:w-auto sm:self-end" onclick={save}>{m.topology_save()}</Button>
  </div>
{/if}
