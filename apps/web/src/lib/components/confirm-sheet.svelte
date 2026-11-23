<!--
  A destructive confirm (ADR 21): the form overlay with a title naming the thing, what the action
  costs, Cancel and the action. A refusal stays beside the action; success closes it with a toast.
-->
<script lang="ts">
  import type { Problem } from "../api/core";
  import { Button } from "@sunreye/ui/button";
  import { confirmed } from "../feedback.ts";
  import { m } from "../paraglide/messages.js";
  import Refusal, { answered } from "../setup/Refusal.svelte";
  import ResponsiveSheet from "./responsive-sheet.svelte";

  let {
    open = $bindable(false),
    title,
    note,
    action,
    done,
    onconfirm,
  }: {
    open?: boolean;
    /** Names the thing and what happens to it. */
    title: string;
    /** The consequence. */
    note: string;
    /** The destructive button's label. */
    action: string;
    /** The toast after success; none when the page itself shows the outcome. */
    done?: string;
    onconfirm: () => Promise<Problem | undefined>;
  } = $props();

  let refused = $state.raw<Problem>();
  let busy = $state(false);

  async function confirm(): Promise<void> {
    busy = true;
    refused = answered(await onconfirm());
    busy = false;

    if (refused !== undefined) return;

    open = false;

    if (done !== undefined) confirmed(done);
  }
</script>

<!-- A refusal belongs to one asking: closing by any means drops it. -->
<ResponsiveSheet
  bind:open={
    () => open,
    (next) => {
      open = next;

      if (!next) refused = undefined;
    }
  }
  label={title}
  titled
>
  <div class="flex flex-col gap-3 px-4 pb-1">
    <p class="text-sm text-muted-foreground">{note}</p>
    <Refusal {refused} />
    <div class="flex flex-wrap justify-end gap-2">
      <Button
        variant="ghost"
        onclick={() => {
          open = false;
          refused = undefined;
        }}>{m.access_cancel()}</Button
      >
      <Button variant="destructive" disabled={busy} onclick={confirm}>{action}</Button>
    </div>
  </div>
</ResponsiveSheet>
