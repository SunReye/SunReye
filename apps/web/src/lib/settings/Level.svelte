<!--
  A level under a settings page, such as one device: the drill-in's page header one level deeper,
  its back button naming the page. It slides in from the right as the drill-in's page does.
-->
<script lang="ts">
  import ChevronLeft from "@lucide/svelte/icons/chevron-left";
  import type { Snippet } from "svelte";
  import { cubicInOut } from "svelte/easing";
  import { Button } from "#lib/components/ui/button/index.js";
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

<section aria-label={title} class="flex flex-col" in:enter>
  <div class="relative flex min-h-12 items-center border-b border-border/60 p-1.5">
    <Button variant="ghost" size="sm" onclick={onback} class="text-brand">
      <ChevronLeft data-icon="inline-start" />
      {back}
    </Button>
    <h3 class="ml-auto truncate px-2.5 text-[15px] font-semibold">{title}</h3>
  </div>
  {@render children()}
</section>
