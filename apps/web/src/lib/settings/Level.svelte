<!--
  A level under a settings page, such as one device: the drill-in's page header one level deeper,
  its back button naming the page. The caller's `DrillPush` slides it in over the page.
-->
<script lang="ts">
  import DrillCard from "../components/drill-in/drill-card.svelte";
  import type { Snippet } from "svelte";
  import DrillHeader from "../components/drill-in/drill-header.svelte";

  let {
    back,
    title,
    onback,
    children,
  }: { back: string; title: string; onback: () => void; children: Snippet } = $props();
</script>

<section aria-label={title} class="min-w-0">
  <DrillCard class="flex min-w-0 flex-col">
    <DrillHeader {back} {title} {onback} heading="h3" />
    {@render children()}
  </DrillCard>
</section>
