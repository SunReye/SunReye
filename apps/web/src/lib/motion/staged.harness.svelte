<!-- Test harness: three staged parts, each with its skeleton; `onfill` hears each part fill. -->
<script lang="ts">
  import Staged from "./Staged.svelte";
  import StagedPart from "./staged-part.harness.svelte";

  let { onfill }: { onfill: (part: string) => void } = $props();
</script>

{#each ["a", "b", "c"] as part (part)}
  <Staged>
    {#snippet skeleton()}<p>{part} waiting</p>{/snippet}
    <StagedPart {part} {onfill} />
  </Staged>
{/each}
