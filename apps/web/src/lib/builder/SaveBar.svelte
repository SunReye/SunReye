<!-- The inspector's foot: undo and redo until save, the day the layout applies from, and save (ADR 20). -->
<script lang="ts">
  import Redo2 from "@lucide/svelte/icons/redo-2";
  import Undo2 from "@lucide/svelte/icons/undo-2";
  import { Button } from "#lib/components/ui/button/index.js";
  import { Input } from "#lib/components/ui/input/index.js";
  import { m } from "../paraglide/messages.js";
  import Outcome from "./Outcome.svelte";
  import type { Session } from "./session.svelte.ts";

  let { session }: { session: Session } = $props();
</script>

<!-- A refusal for one string shows on that string's level, where the save opens it. -->
<Outcome
  misplaced={session.laid.misplaced}
  saved={session.plan.refused === null ? session.saved : undefined}
/>
<div class="flex items-center gap-1.5">
  <Button
    variant="ghost"
    size="icon-sm"
    aria-label={m.builder_undo()}
    disabled={!session.undoable}
    onclick={() => {
      session.undo();
    }}><Undo2 /></Button
  >
  <Button
    variant="ghost"
    size="icon-sm"
    aria-label={m.builder_redo()}
    disabled={!session.redoable}
    onclick={() => {
      session.redo();
    }}><Redo2 /></Button
  >
  <label class="ml-auto flex items-center gap-1.5 text-xs whitespace-nowrap text-muted-foreground">
    {m.builder_applies_from()}
    <Input type="date" required class="h-8 w-auto" bind:value={session.appliesFrom} />
  </label>
  <Button
    size="sm"
    disabled={session.appliesFrom === ""}
    onclick={() => {
      void session.save();
    }}>{m.builder_save()}</Button
  >
</div>
