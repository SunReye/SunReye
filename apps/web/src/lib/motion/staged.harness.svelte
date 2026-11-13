<!-- Test harness: two staged parts, each with its skeleton. -->
<script lang="ts">
  import Staged from "./Staged.svelte";
</script>

{#each ["a", "b"] as part (part)}
  <Staged>
    {#snippet skeleton()}<p>{part} waiting</p>{/snippet}
    <p>{part} filled</p>
  </Staged>
{/each}
