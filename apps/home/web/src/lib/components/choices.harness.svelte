<!-- Test harness: the kit's controls that choose, each over three options, its value set from outside. -->
<script lang="ts">
  import * as Collapsible from "./ui/collapsible/index.js";
  import * as DropdownMenu from "@sunreye/ui/dropdown-menu";
  import * as RadioGroup from "./ui/radio-group/index.js";
  import * as ToggleGroup from "@sunreye/ui/toggle-group";

  let {
    kind,
    value = "a",
    open = false,
  }: {
    kind: "toggle-group" | "radio-group" | "menu" | "collapsible";
    value?: string;
    open?: boolean;
  } = $props();

  const OPTIONS = ["a", "b", "c"];
</script>

{#if kind === "toggle-group"}
  <ToggleGroup.Root type="single" {value} aria-label="Probe">
    {#each OPTIONS as option (option)}
      <ToggleGroup.Item value={option}>{option}</ToggleGroup.Item>
    {/each}
  </ToggleGroup.Root>
{:else if kind === "radio-group"}
  <RadioGroup.Root {value} aria-label="Probe">
    {#each OPTIONS as option (option)}
      <RadioGroup.Item value={option} aria-label={option} />
    {/each}
  </RadioGroup.Root>
{:else if kind === "menu"}
  <DropdownMenu.Root open>
    <DropdownMenu.Trigger>Probe</DropdownMenu.Trigger>
    <DropdownMenu.Content>
      <DropdownMenu.RadioGroup {value}>
        {#each OPTIONS as option (option)}
          <DropdownMenu.RadioItem value={option}>{option}</DropdownMenu.RadioItem>
        {/each}
      </DropdownMenu.RadioGroup>
    </DropdownMenu.Content>
  </DropdownMenu.Root>
{:else}
  <Collapsible.Root {open}>
    <Collapsible.Trigger>Probe</Collapsible.Trigger>
    <Collapsible.Content>Inside</Collapsible.Content>
  </Collapsible.Root>
{/if}
