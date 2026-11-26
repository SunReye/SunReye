<!-- A saved view's name with its save and cancel; a refused name stays for a fix. -->
<script lang="ts">
  import { untrack } from "svelte";
  import type { Problem } from "../api/client.ts";
  import { Button } from "@sunreye/ui/button";
  import { Input } from "@sunreye/ui/input";
  import { m } from "../paraglide/messages.js";
  import Refusal, { answered } from "../setup/Refusal.svelte";

  let {
    name: initial,
    onsubmit,
    onclose,
  }: {
    /** The name the form opens with. */
    name: string;
    /** Saves under the name; a refusal stays beside the action. */
    onsubmit: (name: string) => Promise<Problem | undefined>;
    onclose: () => void;
  } = $props();

  // Each asking builds the form anew: it starts from its own name.
  let name = $state(untrack(() => initial));
  let refused = $state.raw<Problem>();
  let busy = $state(false);

  async function submit(): Promise<void> {
    busy = true;
    // The core compares names as given: the edges' spaces are no part of one.
    refused = answered(await onsubmit(name.trim()));
    busy = false;

    if (refused === undefined) onclose();
  }
</script>

<form
  class="flex flex-col gap-3 px-4 pb-1"
  onsubmit={(event) => {
    event.preventDefault();
    void submit();
  }}
>
  <label class="flex flex-col gap-1.5 text-sm">
    {m.explore_view_name()}
    <Input required autocomplete="off" bind:value={name} />
  </label>
  <Refusal {refused} />
  <div class="flex flex-wrap justify-end gap-2">
    <Button variant="ghost" onclick={onclose}>{m.access_cancel()}</Button>
    <Button type="submit" disabled={busy || name.trim() === ""}>{m.settings_save()}</Button>
  </div>
</form>
