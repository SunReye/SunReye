<!-- Test harness: the root layout around the home page, as the router nests them, or around another screen first. -->
<script lang="ts">
  import Layout from "./+layout.svelte";
  import Page from "./+page.svelte";

  let { home = true }: { home?: boolean } = $props();
</script>

<Layout>
  {#if home}
    <Page />
  {:else}
    <main>Verlauf</main>
  {/if}
</Layout>
