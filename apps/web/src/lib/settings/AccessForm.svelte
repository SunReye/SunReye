<!-- Adds a viewer or a token under Settings › Users & access; a refused draft stays for a fix. -->
<script lang="ts">
  import type { Component, Snippet } from "svelte";
  import type { Problem } from "../api/core";
  import { Button } from "#lib/components/ui/button/index.js";
  import { problemText } from "../i18n/problems";

  let {
    action,
    icon: Icon,
    refused,
    onsubmit,
    children,
  }: {
    /** The submit button's label. */
    action: string;
    icon: Component;
    refused: Problem | undefined;
    onsubmit: () => void;
    children: Snippet;
  } = $props();
</script>

<form
  onsubmit={(event) => {
    event.preventDefault();
    onsubmit();
  }}
  class="flex flex-col gap-3 p-4"
>
  <div class="grid gap-3 sm:grid-cols-2">{@render children()}</div>
  {#if refused}<p role="alert" class="text-sm">{problemText(refused.problem)}</p>{/if}
  <Button type="submit" variant="outline" class="self-start">
    <Icon data-icon="inline-start" />
    {action}
  </Button>
</form>
