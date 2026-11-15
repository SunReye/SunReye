<!-- Test harness: the root layout around the home page, as the router nests them. -->
<script lang="ts">
  import Layout from "./+layout.svelte";
  import Page from "./+page.svelte";

  /** Another screen is shown, as before a route change to the dashboard. */
  let { away = false }: { away?: boolean } = $props();
</script>

<Layout>
  {#if away}
    <main>away</main>
  {:else}
    <Page />
  {/if}
</Layout>
