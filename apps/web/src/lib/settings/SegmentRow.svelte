<!-- A settings row that picks one of a few: its name, a line of status, and a segmented control. -->
<script lang="ts" generics="T extends string">
  import type { Snippet } from "svelte";
  import * as Item from "#lib/components/ui/item/index.js";
  import Segmented from "../components/segmented.svelte";

  let {
    label,
    value,
    options,
    hint,
    onchange,
    children,
  }: {
    label: string;
    value: T;
    /** Each option's value and its text. */
    options: readonly (readonly [T, string])[];
    /** Under the label: what the choice does here and now. */
    hint?: string | undefined;
    /** A segment the user chose, other than the current one. */
    onchange: (next: T) => void;
    /** Under the hint: an action the status calls for. */
    children?: Snippet;
  } = $props();
</script>

<Item.Root class="rounded-none border-0">
  <!-- Too narrow for its status beside the segments, the row puts them on a line of their own. -->
  <Item.Content class="min-w-48">
    <Item.Title class="text-[15px] font-normal">{label}</Item.Title>
    {#if hint}<Item.Description>{hint}</Item.Description>{/if}
    {@render children?.()}
  </Item.Content>
  <Item.Actions>
    <Segmented {options} {value} {label} {onchange} />
  </Item.Actions>
</Item.Root>
