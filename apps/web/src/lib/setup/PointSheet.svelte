<!-- One point while the tree is adjusted: its name, the point it hangs under, or out of the tree. -->
<script lang="ts">
  import Trash2 from "@lucide/svelte/icons/trash-2";
  import type { PointDraft } from "../api/core.ts";
  import { ResponsiveSheet } from "@sunreye/builder/controls";
  import { Button } from "@sunreye/ui/button";
  import { Input } from "@sunreye/ui/input";
  import { m } from "../paraglide/messages.js";
  import MoveField from "./MoveField.svelte";
  import { roleOf } from "./point-look.ts";
  import PointTile from "./PointTile.svelte";

  let {
    open = $bindable(false),
    points,
    index,
    onrename,
    onmove,
    onremove,
  }: {
    open?: boolean;
    points: readonly PointDraft[];
    index: number;
    onrename: (name: string) => void;
    onmove: (parent: number) => void;
    onremove: () => void;
  } = $props();

  const point = $derived(points[index]);

  const root = $derived(point?.parent === null || point?.parent === undefined);
</script>

<ResponsiveSheet bind:open label={point?.name ?? ""}>
  {#if point !== undefined}
    <div
      class="flex max-h-[80dvh] flex-col gap-5 overflow-y-auto px-5 pt-2 pb-2 scroll-fade-y no-scrollbar"
      data-vaul-no-drag
    >
      <div class="flex items-center gap-3">
        <PointTile role={roleOf(point)} active />
        <h2 class="truncate text-lg font-semibold">{point.name}</h2>
      </div>
      <label class="flex flex-col gap-1.5 text-sm">
        {m.topology_name()}
        <Input
          required
          value={point.name}
          oninput={(event) => {
            onrename(event.currentTarget.value);
          }}
        />
      </label>
      {#if !root}<MoveField {points} {index} {onmove} />{/if}
      <div class="flex flex-col gap-2 sm:flex-row-reverse sm:justify-between">
        <Button
          class="w-full sm:w-auto"
          onclick={() => {
            open = false;
          }}>{m.topology_done()}</Button
        >
        {#if !root}
          <Button
            variant="ghost"
            class="w-full text-destructive hover:text-destructive sm:w-auto"
            onclick={() => {
              onremove();
              open = false;
            }}
          >
            <Trash2 />
            {m.topology_remove()}
          </Button>
        {/if}
      </div>
    </div>
  {/if}
</ResponsiveSheet>
