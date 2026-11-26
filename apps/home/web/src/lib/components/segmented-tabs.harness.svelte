<!-- Test harness: segmented tabs that switch content, beside a segmented control of the same words. -->
<script lang="ts">
  import Segmented from "./segmented.svelte";
  import * as Tabs from "./ui/tabs/index.js";

  let { value, onchange }: { value: string; onchange: (next: string) => void } = $props();

  const OPTIONS = [
    ["day", "Tag"],
    ["week", "Woche"],
  ] as const;
</script>

<Tabs.Root {value} onValueChange={onchange}>
  <Tabs.List variant="segmented" aria-label="Tabs">
    {#each OPTIONS as [option, text] (option)}
      <Tabs.Trigger value={option}>{text}</Tabs.Trigger>
    {/each}
  </Tabs.List>
  {#each OPTIONS as [option, text] (option)}
    <Tabs.Content value={option}>{text} zeigt</Tabs.Content>
  {/each}
</Tabs.Root>

<Segmented options={OPTIONS} value="day" label="Segmente" onchange={() => {}} />
