<!--
  What the range is laid over (ADR 22): the picked periods as removable chips, then the quick
  picks not drawn yet and any other day. A chart of five periods offers no more, and says so.
-->
<script lang="ts">
  import Plus from "@lucide/svelte/icons/plus";
  import X from "@lucide/svelte/icons/x";
  import DateField from "../components/date-field.svelte";
  import { Button } from "#lib/components/ui/button/index.js";
  import { Pressable } from "#lib/components/ui/pressable/index.js";
  import { haptics } from "../haptics.ts";
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
          <li
            class="flex h-8 max-w-full items-center rounded-md border border-border/60 bg-foreground/[0.04] pl-2.5 touch:h-11"
          >
            <span class="mr-1.5 size-2 shrink-0 rounded-[1px]" style:background={period.colour}
            ></span>
            <span class="min-w-0 truncate font-medium">{period.name}</span>
            <Pressable
              feedback
              class="ml-1 grid h-full w-8 shrink-0 place-items-center rounded-r-md text-muted-foreground hover:text-foreground touch:w-11"
              aria-label={m.explore_remove({ name: period.name })}
              onclick={() => {
                haptics.light();
                onremove(period);
              }}
            >
              <X class="size-3.5" />
            </Pressable>
          </li>
        {/each}
      </ul>
    {/if}
    {#if !full}
      {#each picks as pick (pick.id)}
        <Button
          variant="outline"
          size="sm"
          onclick={() => {
            haptics.light();
            onadd(pick.entry);
          }}
        >
          <Plus data-icon="inline-start" />{pick.text}
        </Button>
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
