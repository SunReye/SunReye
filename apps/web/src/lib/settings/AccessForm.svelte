<!-- Adds a viewer or a token under Settings › Users & access; a refused draft stays for a fix. -->
<script lang="ts">
  import Refusal from "../setup/Refusal.svelte";
  import type { Component, Snippet } from "svelte";
  import type { Problem } from "../api/core";
  import { Button } from "@sunreye/ui/button";
  import { m } from "../paraglide/messages.js";

  let {
    action,
    icon: Icon,
    refused,
    onsubmit,
    oncancel,
    children,
  }: {
    /** The submit button's label. */
    action: string;
    icon: Component;
    refused: Problem | undefined;
    onsubmit: () => void;
    oncancel: () => void;
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
  <Refusal {refused} />
  <div class="flex justify-end gap-2">
    <Button variant="ghost" onclick={oncancel}>{m.access_cancel()}</Button>
    <Button type="submit">
      <Icon data-icon="inline-start" />
      {action}
    </Button>
  </div>
</form>
