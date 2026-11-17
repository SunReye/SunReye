<!-- The chosen series as removable chips, then "Add series" (ADR 22). -->
<script lang="ts">
  import Plus from "@lucide/svelte/icons/plus";
  import { Button } from "#lib/components/ui/button/index.js";
  import { haptics } from "../haptics.ts";
  import { m } from "../paraglide/messages.js";
  import type { Chosen } from "./picker.ts";
  import SeriesChip from "./SeriesChip.svelte";
  import type { SeriesRef } from "./view.ts";

  let {
    chosen,
    ready,
    onremove,
    onadd,
  }: {
    chosen: readonly Chosen[];
    /** Whether the catalog was read: only then is a series it does not list known to be gone. */
    ready: boolean;
    onremove: (ref: SeriesRef) => void;
    onadd: () => void;
  } = $props();
</script>

<div class="flex flex-wrap items-center gap-2">
  {#if chosen.length > 0}
    <ul class="flex min-w-0 flex-wrap items-center gap-2" aria-label={m.explore_chosen()}>
      {#each chosen as each (`${each.ref.device}:${each.ref.series}`)}
        <SeriesChip
          series={each}
          gone={ready && each.first === null}
          onremove={() => {
            onremove(each.ref);
          }}
        />
      {/each}
    </ul>
  {/if}
  <Button
    variant="outline"
    size="sm"
    onclick={() => {
      haptics.light();
      onadd();
    }}
  >
    <Plus data-icon="inline-start" />{m.explore_add()}
  </Button>
</div>
