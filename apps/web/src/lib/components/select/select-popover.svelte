<!-- A select field's list with a mouse: the kit's Select content, anchored to the trigger. -->
<script lang="ts" generics="Value extends string">
  import type { Snippet } from "svelte";
  import * as Select from "../ui/select/index.js";
  import type { Choice, Section } from "./choices.ts";

  let {
    sections,
    note,
    item,
  }: {
    sections: readonly Section<Value>[];
    note?: string | undefined;
    item?: Snippet<[Choice<Value>]> | undefined;
  } = $props();
</script>

{#snippet row(choice: Choice<Value>)}
  <Select.Item value={choice.value} label={choice.label}>
    {#snippet children()}
      {#if item}{@render item(choice)}{:else}{choice.label}{/if}
    {/snippet}
  </Select.Item>
{/snippet}

<Select.Content>
  {#each sections as section, at (section.heading ?? at)}
    {#if at > 0}<Select.Separator />{/if}
    <Select.Group>
      {#if section.heading !== undefined}
        <Select.GroupHeading>{section.heading}</Select.GroupHeading>
      {/if}
      {#each section.choices as choice (choice.value)}
        {@render row(choice)}
      {/each}
    </Select.Group>
  {/each}
  {#if note !== undefined}
    <Select.Separator />
    <p class="px-2 py-1.5 text-xs text-pretty text-muted-foreground">{note}</p>
  {/if}
</Select.Content>
