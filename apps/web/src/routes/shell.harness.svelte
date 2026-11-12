<!-- Test harness: the root layout around the home page, as the router nests them. -->
<script lang="ts">
  import Layout from "./+layout.svelte";
  import Page from "./+page.svelte";
</script>

<Layout>
  <Page />
</Layout>
