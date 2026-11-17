<!--
  What a sheet's range holds before its tabs (ADR 21): a failed read with its retry, or the one
  sentence for a range before the record, in place of the tabs; else where the record begins or its
  readings stop, above them.
-->
<script lang="ts">
  import type { Snippet } from "svelte";
  import TriangleAlert from "@lucide/svelte/icons/triangle-alert";
  import { Button } from "#lib/components/ui/button/index.js";
  import { haptics } from "../haptics.ts";
  import { m } from "../paraglide/messages.js";
  import type { HeadView } from "./head.svelte.ts";

  let {
    head,
    onretry,
    children,
  }: { head: HeadView | null; onretry: () => void; children: Snippet } = $props();
</script>

{#if head?.state === "error"}
  <div class="flex flex-col items-start gap-3 py-6" role="alert">
    <p class="flex items-center gap-2 text-sm">
      <TriangleAlert class="size-4 shrink-0 text-warning" />
      {m.detail_error()}
    </p>
    <Button
      variant="outline"
      size="sm"
      onclick={() => {
        haptics.light();
        onretry();
      }}>{m.stats_retry()}</Button
    >
  </div>
{:else if head?.state === "before"}
  <p class="py-6 text-sm text-muted-foreground">{head.notes[0]}</p>
{:else}
  {#if head && head.notes.length > 0}
    <p class="text-xs text-muted-foreground">{head.notes.join(" · ")}</p>
  {/if}
  {@render children()}
{/if}
