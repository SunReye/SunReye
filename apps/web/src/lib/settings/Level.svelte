<!--
  A level under a settings page, such as one device: the drill-in's page header one level deeper,
  its back button naming the page. It slides in from the right as the drill-in's page does.
-->
<script lang="ts">
  import type { Snippet } from "svelte";
  import DrillHeader from "../components/drill-in/drill-header.svelte";
  import { slideIn } from "../motion/slide.ts";

  let {
    back,
    title,
    onback,
    children,
  }: { back: string; title: string; onback: () => void; children: Snippet } = $props();
</script>

<section aria-label={title} class="min-w-0" in:slideIn={1}>
  <div class="drill-card flex min-w-0 flex-col">
    <DrillHeader {back} {title} {onback} heading="h3" />
    {@render children()}
  </div>
</section>
