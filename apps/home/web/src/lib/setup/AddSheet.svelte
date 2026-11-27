<!-- What the tree leaves out, an unused port too: a row opens the list, one tap adds below the root. -->
<script lang="ts">
  import { Pressable } from "@sunreye/ui/pressable";
  import Plus from "@lucide/svelte/icons/plus";
  import type { Device, PointDraft } from "../api/core.ts";
  import { ResponsiveSheet } from "@sunreye/builder/controls";
  import { haptics } from "@sunreye/ui/haptics";
  import { m } from "../paraglide/messages.js";
  import { roleOf } from "./point-look.ts";
  import PointTile from "./PointTile.svelte";
  import { identity } from "./topology.ts";

  let {
    points,
    devices,
    onadd,
  }: {
    /** The points left out; the row hides while there is none. */
    points: readonly PointDraft[];
    devices: readonly Device[];
    onadd: (point: PointDraft) => void;
  } = $props();

  let open = $state(false);

  function deviceOf(point: PointDraft): string {
    return devices.find(({ id }) => id === point.claims[0]?.device)?.name ?? "";
  }
</script>

{#if points.length > 0}
  <Pressable
    feedback
    class="flex min-h-14 w-full items-center gap-3 px-4 py-2 text-[15px] text-muted-foreground"
    onclick={() => {
      open = true;
    }}
  >
    <span
      class="grid size-9 shrink-0 place-items-center rounded-md border-2 border-dashed border-border"
      aria-hidden="true"
    >
      <Plus class="size-5" />
    </span>
    {m.topology_add()}
  </Pressable>
{/if}
<ResponsiveSheet bind:open label={m.topology_add()}>
  <div class="flex flex-col px-3 pt-1 pb-2">
    <h2 class="px-2 pb-2 text-lg font-semibold">{m.topology_add()}</h2>
    {#each points as point (identity(point))}
      <Pressable
        feedback
        class="flex min-h-14 items-center gap-3 rounded-md px-2 text-left"
        aria-label={point.name}
        onclick={() => {
          haptics.light();
          onadd(point);
          open = false;
        }}
      >
        <PointTile role={roleOf(point)} active={false} />
        <span class="flex min-w-0 flex-col">
          <span class="truncate text-[15px] font-medium">{point.name}</span>
          <span class="truncate text-xs text-muted-foreground">{deviceOf(point)}</span>
        </span>
      </Pressable>
    {/each}
  </div>
</ResponsiveSheet>
