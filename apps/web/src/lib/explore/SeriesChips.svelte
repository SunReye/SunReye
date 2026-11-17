<!-- The chosen series as removable chips, then "Add series" (ADR 22). -->
<script lang="ts">
  import Plus from "@lucide/svelte/icons/plus";
  import X from "@lucide/svelte/icons/x";
  import { Button } from "#lib/components/ui/button/index.js";
  import { Pressable } from "#lib/components/ui/pressable/index.js";
  import { haptics } from "../haptics.ts";
  import { m } from "../paraglide/messages.js";
  import type { Chosen } from "./picker.ts";
  import type { SeriesRef } from "./view.ts";

  let {
    chosen,
    onremove,
    onadd,
  }: {
    chosen: readonly Chosen[];
    onremove: (ref: SeriesRef) => void;
    onadd: () => void;
  } = $props();
</script>

<div class="flex flex-wrap items-center gap-2">
  {#if chosen.length > 0}
    <ul class="flex min-w-0 flex-wrap items-center gap-2" aria-label={m.explore_chosen()}>
      {#each chosen as each (`${each.ref.device}:${each.ref.series}`)}
        <li
          class="flex h-8 max-w-full items-center rounded-md border border-border/60 bg-foreground/[0.04] pl-2.5 text-xs touch:h-11"
        >
          <span class="min-w-0 truncate">
            <span class="font-medium"
              >{each.estimated ? "≈ " : ""}{each.label}</span
            >
            <span class="text-muted-foreground">
              · {each.device}{each.removed ? ` (${m.explore_removed()})` : ""}</span
            >
          </span>
          <Pressable
            feedback
            class="ml-1 grid h-full w-8 shrink-0 place-items-center rounded-r-md text-muted-foreground hover:text-foreground touch:w-11"
            aria-label={m.explore_remove({ name: each.label })}
            onclick={() => {
              haptics.light();
              onremove(each.ref);
            }}
          >
            <X class="size-3.5" />
          </Pressable>
        </li>
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
