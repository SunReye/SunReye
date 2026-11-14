<!--
  A level under a settings page, such as one device: the drill-in's page header one level deeper,
  its back button naming the page. It slides in from the right as the drill-in's page does.
-->
<script lang="ts">
  import type { Snippet } from "svelte";
  import { cubicInOut } from "svelte/easing";
  import DrillHeader from "../components/drill-in/drill-header.svelte";
  import { motionMs } from "../motion.ts";

  let {
    back,
    title,
    onback,
    children,
  }: { back: string; title: string; onback: () => void; children: Snippet } = $props();

  /** The drill-in's ease-in-out between two resting places (ADR 21). */
  const SLIDE_MS = 300;

  function enter(_node: Element) {
    return {
      duration: motionMs(SLIDE_MS),
      easing: cubicInOut,
      css: (_t: number, u: number) => `transform: translateX(${u * 100}%)`,
    };
  }
</script>

<section aria-label={title} class="min-w-0" in:enter>
  <div class="drill-card flex min-w-0 flex-col">
    <DrillHeader {back} {title} {onback} heading="h3" />
    {@render children()}
  </div>
</section>
