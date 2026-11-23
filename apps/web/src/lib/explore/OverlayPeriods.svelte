<!--
  What the range is laid over (ADR 22): the picked periods as removable chips, then the quick
  picks not drawn yet and any other day. A chart of five periods offers no more, and says so.
-->
<script lang="ts">
  import AddButton from "../components/add-button.svelte";
  import { DateField } from "@sunreye/builder/controls";
  import RemovableChip from "../components/removable-chip.svelte";
  import { m } from "../paraglide/messages.js";
  import type { OverlayPeriod } from "./overlay.ts";
  import type { Shown } from "./overlay-chart.ts";
  import type { Offered } from "./overlay-view.svelte.ts";

  let {
    hidden = false,
    picked,
    picks,
    full,
    max,
    onadd,
    onremove,
  }: {
    /** Fullscreen leaves the periods to the legend (ADR 22). */
    hidden?: boolean;
    /** The periods beside the range. */
    picked: readonly Shown[];
    picks: readonly Offered[];
    full: boolean;
    /** The last day that can be picked, `2026-11-16`. */
    max: string;
    /** Takes a quick pick's offset, `-1d`, or a picked date. */
    onadd: (entry: string) => void;
    onremove: (period: OverlayPeriod) => void;
  } = $props();

  const id = $props.id();
</script>

<div class="flex flex-col gap-1.5" {hidden}>
  <div class="flex flex-wrap items-center gap-2 text-xs">
    <span {id} class="text-muted-foreground">{m.explore_overlay_with()}</span>
    {#if picked.length > 0}
      <ul class="contents" aria-labelledby={id}>
        {#each picked as period (period.key)}
          <RemovableChip
            remove={m.explore_remove({ name: period.name })}
            onremove={() => {
              onremove(period);
            }}
          >
            <span class="mr-1.5 size-2 shrink-0 rounded-[1px]" style:background={period.colour}
            ></span>
            <span class="min-w-0 truncate font-medium">{period.name}</span>
          </RemovableChip>
        {/each}
      </ul>
    {/if}
    {#if !full}
      {#each picks as pick (pick.id)}
        <AddButton
          text={pick.text}
          onadd={() => {
            onadd(pick.entry);
          }}
        />
      {/each}
      <DateField
        variant="compact"
        value=""
        min="2000-01-01"
        {max}
        label={m.explore_overlay_date()}
        onchange={onadd}
      />
    {/if}
  </div>
  {#if full}
    <p class="text-xs text-muted-foreground">{m.explore_overlay_full()}</p>
  {/if}
</div>
