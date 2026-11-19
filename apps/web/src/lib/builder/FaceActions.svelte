<!-- The context toolbar for a roof face (ADR 20): fill it, auto-string its unwired modules or say why
  not, and keep or drop the proposal that makes. -->
<script lang="ts">
  import Cable from "@lucide/svelte/icons/cable";
  import Check from "@lucide/svelte/icons/check";
  import Grid2x2Plus from "@lucide/svelte/icons/grid-2x2-plus";
  import X from "@lucide/svelte/icons/x";
  import { m } from "../paraglide/messages.js";
  import { fillAt, freeAt, gridAt } from "./context-actions.ts";
  import type { Session } from "./session.svelte.ts";
  import ToolButton from "./ToolButton.svelte";

  let { session, onrefuse }: { session: Session; onrefuse: (reason?: string) => void } = $props();

  const grid = $derived(gridAt(session));
  const full = $derived(freeAt(session).length === 0);
  const proposed = $derived(session.wiring.proposed);
  const loose = $derived(session.wiring.loose.some((face) => face.grid === grid));
</script>

{#if proposed !== undefined}
  <span role="status" class="shrink-0 px-2 text-sm font-medium">
    {m.builder_proposal({ count: proposed.strings })}
  </span>
  <ToolButton
    icon={X}
    label={m.builder_discard()}
    onclick={() => {
      session.wiring.discard();
    }}
  />
  <ToolButton
    variant="default"
    icon={Check}
    label={m.builder_keep()}
    onclick={() => {
      session.wiring.keep();
    }}
  />
{:else}
  <ToolButton
    icon={Grid2x2Plus}
    label={m.builder_fill()}
    disabled={full}
    onclick={() => {
      fillAt(session);
    }}
  />
  {#if loose}
    <ToolButton
      icon={Cable}
      label={m.builder_auto()}
      aria-label={m.builder_auto_label()}
      onclick={() => {
        session.wiring.auto(grid);
        onrefuse(session.wiring.refused);
      }}
    />
  {/if}
{/if}
