<!--
  A range read's content (ADR 21): its pane, which travels, or in its place the one load failure
  with its retry, a refusal saying the core's reason; the range stays.
-->
<script lang="ts" generics="T">
  import type { Snippet } from "svelte";
  import LoadFailed from "../components/load-failed.svelte";
  import { m } from "../paraglide/messages.js";
  import type { Loaded, RangeData } from "./range-data.svelte.ts";
  import RangePane from "./RangePane.svelte";

  let {
    data,
    waiting: before,
    children: content,
  }: {
    data: Pick<RangeData<T>, "failed" | "refused" | "retry" | "travel">;
    /** Before the first figures. */
    waiting: Snippet;
    /** A pane's figures; null where the range is not read yet. */
    children: Snippet<[Loaded<T> | null]>;
  } = $props();
</script>

{#if data.failed}
  <LoadFailed text={m.detail_error()} refused={data.refused} onretry={data.retry} />
{:else}
  <RangePane model={data.travel}>
    {#snippet children(p)}
      {@render content(p.got)}
    {/snippet}
    {#snippet waiting()}
      {@render before()}
    {/snippet}
  </RangePane>
{/if}
