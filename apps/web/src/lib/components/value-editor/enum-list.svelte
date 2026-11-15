<!-- An enumerated setting's values as the registry's list rows (ADR 21). -->
<script lang="ts">
  import { Pressable } from "../ui/pressable/index.js";
  import Check from "@lucide/svelte/icons/check";
  import * as Item from "#lib/components/ui/item/index.js";
  import { cn } from "#lib/utils.js";
  import { haptics } from "../../haptics.ts";
  import { m } from "../../paraglide/messages.js";

  let {
    name,
    options,
    now,
    choice = $bindable(),
  }: {
    name: string;
    options: readonly Readonly<{ value: number; text: string }>[];
    /** The device's value; `null` when unknown. */
    now: number | null;
    choice: number;
  } = $props();
</script>

<!-- The group slides its accent and bar to the current row. -->
<Item.Group
  role="radiogroup"
  aria-label={name}
  class="overflow-hidden rounded-md border border-border/60"
>
  {#each options as o (o.value)}
    <Item.Root variant="list" size="list-sm" aria-current={choice === o.value}>
      {#snippet child({ props })}
        <Pressable
          {...props}
          role="radio"
          aria-checked={choice === o.value}
          onclick={() => {
            if (choice !== o.value) haptics.selection();

            choice = o.value;
          }}
          class={cn(props.class as string, "text-left last:border-b-0")}
        >
          <Item.Content>
            <Item.Title>{o.text}</Item.Title>
          </Item.Content>
          <Item.Actions>
            {#if now === o.value}<span class="text-xs whitespace-nowrap text-muted-foreground"
                >{m.editor_now()}</span
              >{/if}
            {#if choice === o.value}<Check class="size-4 text-primary" />{/if}
          </Item.Actions>
        </Pressable>
      {/snippet}
    </Item.Root>
  {/each}
</Item.Group>
