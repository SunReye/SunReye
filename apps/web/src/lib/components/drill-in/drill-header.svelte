<!--
  A drill-in level's header: back, the centred title, and a column that mirrors back so the title
  sits at the same x on every level. Back and title cut with an ellipsis rather than overlap; on a
  phone's width back is its chevron alone, its label left to assistive tech. The top level has no
  back. An `action` takes the mirror's place and the title then starts beside back, a `sub` line
  under it.
-->
<script lang="ts">
  import type { Snippet } from "svelte";
  import ChevronLeft from "@lucide/svelte/icons/chevron-left";
  import { Button } from "../ui/button/index.js";

  let {
    back,
    title,
    onback,
    sub,
    action,
    heading = "h2",
    class: className,
  }: {
    /** The level above's title; none on the top level. */
    back?: string | undefined;
    title: string;
    onback?: (() => void) | undefined;
    /** A line under the title, such as how far setup has come. */
    sub?: string;
    action?: Snippet;
    heading?: "h2" | "h3";
    class?: string;
  } = $props();
</script>

<div
  data-drill="header"
  class={[
    "@container grid min-h-12 items-center gap-1 border-b border-border/60 p-1.5",
    action
      ? "grid-cols-[auto_minmax(0,1fr)_auto]"
      : "grid-cols-[minmax(2.25rem,1fr)_minmax(0,auto)_minmax(2.25rem,1fr)]",
    className,
  ]}
>
  {#if back !== undefined && onback}
    <Button
      variant="ghost"
      size="sm"
      onclick={onback}
      class="max-w-full min-w-0 justify-self-start text-brand"
    >
      <ChevronLeft data-icon="inline-start" />
      <span class="truncate @max-[26rem]:sr-only">{back}</span>
    </Button>
  {:else}
    <span></span>
  {/if}
  <div class={["flex min-w-0 flex-col px-1 leading-tight", action ? "text-left" : "text-center"]}>
    <svelte:element this={heading} class="truncate text-[15px] font-semibold">
      {title}
    </svelte:element>
    {#if sub !== undefined}
      <span class="text-xs text-muted-foreground tabular-nums">{sub}</span>
    {/if}
  </div>
  {#if action}<div class="justify-self-end">{@render action()}</div>{/if}
</div>
