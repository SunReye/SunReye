<!-- Under the figures: the verdict, then the open question's tabs. -->
<script lang="ts">
  import * as Tabs from "#lib/components/ui/tabs/index.js";
  import type { CardText } from "./card-text.ts";
  import type { Summary } from "./summary.ts";
  import Verdict from "./Verdict.svelte";

  let {
    text,
    summary,
    plant,
    tab,
    onchoose,
  }: {
    text: CardText;
    summary: Summary | null;
    /** The plant's verdict names no gap. */
    plant: boolean;
    tab: string;
    onchoose: (tab: string) => void;
  } = $props();
</script>

<Verdict
  id={text.verdictId}
  sentence={summary?.sentence ?? null}
  gapHours={plant ? 0 : (summary?.gapHours ?? 0)}
/>

<Tabs.Root bind:value={() => tab, onchoose}>
  <Tabs.List variant="segmented" aria-label={text.tabsLabel}>
    {#each text.tabs as [t, label] (t)}
      <Tabs.Trigger value={t}>{label}</Tabs.Trigger>
    {/each}
  </Tabs.List>
</Tabs.Root>
