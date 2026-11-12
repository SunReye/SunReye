<!-- One measurement point: its name, and below the root the point it hangs under. -->
<script lang="ts">
  import Trash2 from "@lucide/svelte/icons/trash-2";
  import type { PointDraft } from "../api/core.ts";
  import { Button } from "#lib/components/ui/button/index.js";
  import { Input } from "#lib/components/ui/input/index.js";
  import { m } from "../paraglide/messages.js";
  import { SELECT } from "./fields.ts";

  let {
    point,
    number,
    depth,
    earlier,
    onchange,
    onremove,
  }: {
    point: PointDraft;
    /** Counted from 1, the root first. */
    number: number;
    /** Levels below the root, for the indent. */
    depth: number;
    /** The points before it: only one of them may be its parent, so parents stay first. */
    earlier: readonly PointDraft[];
    onchange: (change: Readonly<Partial<PointDraft>>) => void;
    onremove: () => void;
  } = $props();
</script>

<li class="flex flex-col gap-2 py-3 pr-4" style:padding-left="{16 + Math.min(depth, 4) * 20}px">
  <div class="flex items-center gap-2">
    <span
      class="grid size-6 shrink-0 place-items-center rounded-sm bg-foreground/[0.06] text-xs text-muted-foreground tabular-nums"
      aria-hidden="true">{number}</span
    >
    <Input
      required
      class="flex-1"
      aria-label={m.topology_name({ number })}
      value={point.name}
      oninput={(event) => {
        onchange({ name: event.currentTarget.value });
      }}
    />
    {#if number > 1}
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={m.topology_remove({ number })}
        onclick={onremove}
      >
        <Trash2 />
      </Button>
    {/if}
  </div>
  {#if number > 1}
    <label class="flex items-center gap-2 pl-8 text-xs text-muted-foreground">
      {m.topology_under()}
      <select
        aria-label={m.topology_parent({ number })}
        class={[SELECT, "h-8 flex-1"]}
        value={point.parent}
        onchange={(event) => {
          onchange({ parent: Number(event.currentTarget.value) });
        }}
      >
        {#each earlier as parent, at (at)}
          <option value={at}>{parent.name}</option>
        {/each}
      </select>
    </label>
  {/if}
</li>
