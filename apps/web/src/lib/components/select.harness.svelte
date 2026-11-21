<!-- Test harness: the kit's Select open over three options, its value set from outside. -->
<script lang="ts">
  import * as Select from "./ui/select/index.js";

  let { value = "a" }: { value?: string } = $props();

  const OPTIONS = ["a", "b", "c"];
</script>

<Select.Root type="single" open {value}>
  <Select.Trigger aria-label="Probe">{value}</Select.Trigger>
  <Select.Content>
    {#each OPTIONS as option (option)}
      <Select.Item value={option} label={option} />
    {/each}
  </Select.Content>
</Select.Root>
