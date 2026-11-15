<!-- The inspector's foot: undo and redo until save, the day the layout applies from, and save (ADR 20). -->
<script lang="ts">
  import Redo2 from "@lucide/svelte/icons/redo-2";
  import Undo2 from "@lucide/svelte/icons/undo-2";
  import { toast } from "svelte-sonner";
  import { Button } from "#lib/components/ui/button/index.js";
  import { m } from "../paraglide/messages.js";
  import DateField from "./DateField.svelte";
  import Outcome from "./Outcome.svelte";
  import type { Session } from "./session.svelte.ts";

  let { session }: { session: Session } = $props();

  async function save() {
    await session.save();

    // The confirmation is a toast (ADR 21); a refusal stays here, where it is fixed.
    if (session.saved !== undefined && !("problem" in session.saved)) {
      toast.success(m.builder_saved());
    }
  }
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
  <span class="ml-auto text-xs whitespace-nowrap text-muted-foreground" aria-hidden="true">
    {m.builder_applies_from()}
  </span>
  <DateField bind:value={session.appliesFrom} label={m.builder_applies_from()} />
  <Button
    size="sm"
    onclick={() => {
      void save();
    }}>{m.builder_save()}</Button
  >
</div>
