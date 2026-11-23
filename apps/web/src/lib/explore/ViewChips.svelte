<!--
  The saved views as chips, in the order saved (ADR 22): a tap opens one, and the one the route
  shows is marked. One row that scrolls sideways, so twenty of them leave the chart where it is.
-->
<script lang="ts">
  import { Pressable } from "@sunreye/ui/pressable";
  import { m } from "../paraglide/messages.js";
  import type { View } from "./saved.ts";

  let {
    views,
    marked,
    onopen,
  }: {
    views: readonly View[];
    marked: View | undefined;
    onopen: (view: View) => void;
  } = $props();
</script>

{#if views.length > 0}
  <ul
    class="-mx-3 flex gap-2 overflow-x-auto px-3 scroll-fade-x no-scrollbar sm:-mx-5 sm:px-5"
    aria-label={m.explore_views()}
  >
    {#each views as view (view.id)}
      {@const on = view.id === marked?.id}
      <li class="shrink-0">
        <Pressable
          feedback
          aria-pressed={on}
          class={[
            "block h-8 max-w-56 truncate rounded-md border px-3 text-xs font-medium touch:h-11 touch:px-4",
            on
              ? "border-brand/50 bg-brand/12 text-foreground"
              : "border-border/60 text-muted-foreground hover:text-foreground",
          ]}
          onclick={() => {
            onopen(view);
          }}
        >
          {view.name}
        </Pressable>
      </li>
    {/each}
  </ul>
{/if}
