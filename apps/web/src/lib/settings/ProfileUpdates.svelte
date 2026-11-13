<script lang="ts">
  import type { Core, Declared, Problem, Update } from "../api/core";
  import { problemText } from "../i18n/problems";
  import { m } from "../paraglide/messages.js";
  import { Button } from "#lib/components/ui/button/index.js";
  import * as Table from "#lib/components/ui/table/index.js";
  import { boundsText } from "./bounds";
  import { settingLabel } from "./setting-label.ts";

  let { core, onapplied }: { core: Core; onapplied: () => void } = $props();

  const CHANGES = {
    added: m.change_added,
    removed: m.change_removed,
    changed: m.change_changed,
  };

  // Read again after each apply; the core refuses them without the admin's session.
  let updates = $derived(core.updates());
  let pending = $state(false);
  let problem = $state.raw<Problem>();

  async function apply(id: string): Promise<void> {
    pending = true;
    const answer = await core.apply(id);
    problem = "problem" in answer ? answer : undefined;
    pending = false;
    updates = core.updates();
    onapplied();
  }

  function bounds(declared: Declared | null | undefined): string {
    return declared ? boundsText(declared.range, declared.values, declared.step) : "–";
  }
</script>

{#await updates then answer}
  {#if !("problem" in answer) && answer.length > 0}
    <section aria-labelledby="updates-title" class="flex flex-col gap-3 p-4">
      <header class="flex flex-col gap-1">
        <h3 id="updates-title" class="text-[15px] font-medium">{m.updates_title()}</h3>
        <p class="text-sm text-muted-foreground">{m.updates_note()}</p>
      </header>
      {#each answer as update (update.id)}
        {@render diff(update)}
      {/each}
    </section>
  {/if}
{/await}
{#if problem}
  <p role="alert" class="px-4 text-sm text-destructive">{problemText(problem.problem)}</p>
{/if}

{#snippet diff(update: Update)}
  {@const title = m.updates_profile({ id: update.id, from: update.from, to: update.to })}
  <Table.Root aria-label={title}>
    <Table.Caption class="mt-0 mb-2 text-start font-medium text-foreground caption-top">{title}</Table.Caption>
    <Table.Header>
      <Table.Row>
        <Table.Head>{m.updates_key()}</Table.Head>
        <Table.Head>{m.updates_change()}</Table.Head>
        <Table.Head>{m.updates_before()}</Table.Head>
        <Table.Head>{m.updates_after()}</Table.Head>
      </Table.Row>
    </Table.Header>
    <Table.Body>
      {#each update.settings as setting (setting.key)}
        <Table.Row>
          <Table.Head scope="row">{settingLabel(setting)}</Table.Head>
          <Table.Cell>{CHANGES[setting.change]()}</Table.Cell>
          <Table.Cell>{bounds(setting.before)}</Table.Cell>
          <Table.Cell>{bounds(setting.after)}</Table.Cell>
        </Table.Row>
      {/each}
      {#each update.quantities as quantity (quantity.key)}
        <Table.Row>
          <Table.Head scope="row">{settingLabel(quantity)}</Table.Head>
          <Table.Cell>{CHANGES[quantity.change]()}</Table.Cell>
        </Table.Row>
      {/each}
    </Table.Body>
  </Table.Root>
  <Button class="self-start" disabled={pending} onclick={() => apply(update.id)}>
    {m.updates_apply({ id: update.id })}
  </Button>
{/snippet}
