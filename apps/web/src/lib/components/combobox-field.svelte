<!--
  One choice from a long list, found by typing: the kit's Command in a Popover. The trigger shows
  the chosen option; picking one closes the list.
-->
<script lang="ts">
  import Check from "@lucide/svelte/icons/check";
  import ChevronsUpDown from "@lucide/svelte/icons/chevrons-up-down";
  import { cn } from "../utils.ts";
  import { buttonVariants } from "./ui/button/index.js";
  import * as Command from "./ui/command/index.js";
  import * as Popover from "./ui/popover/index.js";

  let {
    value = $bindable(),
    options,
    id,
    search,
    none,
  }: {
    value: string;
    options: readonly string[];
    /** A visible label points at it. */
    id: string;
    /** The search box's placeholder. */
    search: string;
    /** What the list says when nothing matches. */
    none: string;
  } = $props();

  let open = $state(false);
</script>

<Popover.Root bind:open>
  <Popover.Trigger
    {id}
    role="combobox"
    aria-expanded={open}
    class={cn(
      buttonVariants({ variant: "outline" }),
      "w-full justify-between font-normal touch:h-11",
    )}
  >
    <span class="truncate">{value}</span>
    <ChevronsUpDown class="text-muted-foreground" />
  </Popover.Trigger>
  <Popover.Content class="w-(--bits-popover-anchor-width) min-w-64 p-0" align="start">
    <Command.Root>
      <Command.Input placeholder={search} />
      <Command.List>
        <Command.Empty>{none}</Command.Empty>
        <Command.Group>
          {#each options as option (option)}
            <Command.Item
              value={option}
              onSelect={() => {
                value = option;
                open = false;
              }}
            >
              {option}
              <Check class={["ml-auto", option !== value && "invisible"]} />
            </Command.Item>
          {/each}
        </Command.Group>
      </Command.List>
    </Command.Root>
  </Popover.Content>
</Popover.Root>
