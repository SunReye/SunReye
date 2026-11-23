<!-- The Strings group (ADR 20): each inverter, its MPPT inputs and the strings on each, every
  warning beside what it judges; the modules in no string, one tap from a selection. -->
<script lang="ts">
  import { Button } from "@sunreye/ui/button";
  import { m } from "../paraglide/messages.js";
  import AddButtons from "./AddButtons.svelte";
  import { additions } from "./additions.ts";
  import ProposalBar from "./ProposalBar.svelte";
  import type { Session } from "./session.svelte.ts";
  import StringRows from "./StringRows.svelte";

  let { session }: { session: Session } = $props();

  const plan = $derived(session.plan);

  const unwired = $derived(session.wiring.unwired);
  const adds = $derived(additions("strings", plan, session.moduleTypes[0]?.id));
</script>

<StringRows
  {plan}
  onpick={(index) => {
    session.go({ kind: "string", index });
  }}
/>

{#if session.wiring.proposed !== undefined}
  <ProposalBar wiring={session.wiring} proposed={session.wiring.proposed} />
{:else}
  <div class="flex flex-col gap-2 p-3">
    {#if unwired.length > 0}
      <Button
        variant="outline"
        class="min-h-11 justify-start"
        aria-label={m.builder_unwired_select({ count: unwired.length })}
        onclick={() => {
          session.wiring.select(unwired);
        }}
      >
        {m.builder_unwired_count({ count: unwired.length })}
      </Button>
    {/if}
    {#each session.wiring.loose as { grid, face, count } (grid)}
      <Button
        variant="outline"
        class="h-auto min-h-11 justify-start text-left whitespace-normal"
        onclick={() => {
          session.wiring.auto(grid);
        }}
      >
        {m.builder_auto_string({ face, count })}
      </Button>
    {/each}
    {#if session.wiring.refused !== undefined && session.wiring.selection.length === 0}
      <p role="alert" class="text-sm text-destructive">{session.wiring.refused}</p>
    {/if}
    <p class="text-sm text-muted-foreground">{m.builder_string_hint()}</p>
  </div>

  <AddButtons
    {adds}
    onchange={(next) => {
      session.change(next);
    }}
    onlevel={(level) => {
      session.go(level);
    }}
  />
{/if}
