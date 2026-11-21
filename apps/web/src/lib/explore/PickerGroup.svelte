<!-- One role namespace of a device in the picker; Extras stay folded until opened or searched. -->
<script lang="ts">
  import Check from "@lucide/svelte/icons/check";
  import ChevronDown from "@lucide/svelte/icons/chevron-down";
  import * as Collapsible from "#lib/components/ui/collapsible/index.js";
  import { Pressable } from "#lib/components/ui/pressable/index.js";
  import type { PickerGroup, PickerSeries } from "./picker.ts";
  import type { SeriesRef } from "./view.ts";

  let {
    group,
    untitled = false,
    chosen,
    full,
    onpick,
  }: {
    group: PickerGroup;
    /** The device's heading already says the group's title. */
    untitled?: boolean;
    chosen: (ref: SeriesRef) => boolean;
    /** Whether the chart has no room for a series that is not chosen (ADR 22). */
    full: (series: PickerSeries) => boolean;
    onpick: (ref: SeriesRef) => void;
  } = $props();

  const TITLE = "px-4 pt-2 pb-1 text-xs font-medium text-muted-foreground";
</script>

{#snippet rows()}
  <ul class="divide-y divide-border/40">
    {#each group.series as each (each.ref.series)}
      {@const on = chosen(each.ref)}
      {@const off = !on && full(each)}
      <li>
        <Pressable
          feedback
          aria-pressed={on}
          disabled={off}
          class={[
            "flex min-h-10 w-full items-center gap-2 px-4 py-1.5 text-left touch:min-h-12",
            on && "bg-foreground/[0.05]",
          ]}
          onclick={() => {
            onpick(each.ref);
          }}
        >
          <span class="min-w-0 flex-1 truncate text-sm"
            >{each.estimated ? "≈ " : ""}{each.label}</span
          >
          {#if each.unit !== null}
            <span class="shrink-0 text-xs text-muted-foreground tabular-nums">{each.unit}</span>
          {/if}
          <Check class={["size-4 shrink-0 text-brand", !on && "invisible"]} />
        </Pressable>
      </li>
    {/each}
  </ul>
{/snippet}

{#if group.collapsed}
  <Collapsible.Root>
    <Collapsible.Trigger
      class="flex w-full items-center justify-between gap-2 {TITLE} outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
    >
      {group.title}
      <ChevronDown class="size-3.5" />
    </Collapsible.Trigger>
    <Collapsible.Content>{@render rows()}</Collapsible.Content>
  </Collapsible.Root>
{:else}
  {#if !untitled}
    <h4 class={TITLE}>{group.title}</h4>
  {/if}
  {@render rows()}
{/if}
