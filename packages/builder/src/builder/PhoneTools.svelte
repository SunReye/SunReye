<!--
  The canvas's own buttons on a phone (ADR 20): undo, and "+", which opens a sheet of everything
  the scene can add. An addition opens in the pulled-up inspector.
-->
<script lang="ts">
  import Plus from "@lucide/svelte/icons/plus";
  import Undo2 from "@lucide/svelte/icons/undo-2";
  import { Button } from "@sunreye/ui/button";
  import { m } from "../paraglide/messages.js";
  import AddSheet from "./AddSheet.svelte";
  import type { Session } from "./session.svelte.ts";

  let { session, moduleType }: { session: Session; moduleType: number | undefined } = $props();

  let adding = $state(false);
</script>

<div
  role="toolbar"
  aria-label={m.builder_tools()}
  aria-orientation="vertical"
  class="canvas-chip flex flex-col gap-0.5 rounded-md p-0.5 ring-1 ring-border/60 elevation-1"
>
  <Button
    variant="ghost"
    size="icon-lg"
    aria-label={m.builder_undo()}
    disabled={!session.undoable}
    onclick={() => {
      session.undo();
    }}
  >
    <Undo2 />
  </Button>
  <Button
    size="icon-lg"
    aria-label={m.builder_add()}
    onclick={() => {
      adding = true;
    }}
  >
    <Plus />
  </Button>
</div>

<AddSheet
  bind:open={adding}
  plan={session.plan}
  {moduleType}
  onadd={({ draft, level }) => {
    adding = false;
    session.add(draft, level);
  }}
/>
