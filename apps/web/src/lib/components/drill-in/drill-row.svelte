<!-- One group row of the drill-in's root list: icon, label and value summary. -->
<script lang="ts">
  import { Pressable } from "../ui/pressable/index.js";
  import ChevronRight from "@lucide/svelte/icons/chevron-right";
  import * as Item from "../ui/item/index.js";
  import type { DrillGroup } from "./drill-in.svelte";

  let {
    group,
    onclick,
    current,
  }: {
    group: DrillGroup;
    onclick: () => void;
    /** In two panes: whether the right pane shows this group. Unset in the drill-in, which shows a chevron. */
    current?: boolean;
  } = $props();
</script>

<Item.Root class="rounded-none border-0">
  {#snippet child({ props })}
    <Pressable
      feedback
      {...props}
      aria-current={current === true ? "page" : undefined}
      disabled={group.disabled}
      {onclick}
      class={[
        props.class,
        "group relative text-left disabled:pointer-events-none disabled:opacity-70",
        current === true && "bg-muted",
      ]}
    >
      {#if current === true}<span class="absolute inset-y-0 left-0 w-0.5 bg-brand"></span>{/if}
      {#if group.icon}
        <Item.Media class="size-9 rounded-md bg-foreground/[0.06] text-muted-foreground">
          <group.icon class="size-[18px]" />
        </Item.Media>
      {/if}
      <Item.Content>
        <Item.Title class="text-[15px]">{group.label}</Item.Title>
        {#if group.summary}
          <Item.Description class="truncate tabular-nums">{group.summary}</Item.Description>
        {/if}
      </Item.Content>
      {#if current === undefined && group.disabled !== true}
        <Item.Actions>
          <ChevronRight
            class="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5"
          />
        </Item.Actions>
      {/if}
    </Pressable>
  {/snippet}
</Item.Root>
