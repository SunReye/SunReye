<script lang="ts">
  import type { Core, Declared, Problem, Update } from "../api/core";
  import { problemText } from "../i18n/problems";
  import { m } from "../paraglide/messages.js";
  import { boundsText } from "./bounds";

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
    <section>
      <h2>{m.updates_title()}</h2>
      <p>{m.updates_note()}</p>
      {#each answer as update (update.id)}
        {@render diff(update)}
      {/each}
    </section>
  {/if}
{/await}
{#if problem}
  <p role="alert">{problemText(problem.problem)}</p>
{/if}

{#snippet diff(update: Update)}
  {@const title = m.updates_profile({ id: update.id, from: update.from, to: update.to })}
  <table aria-label={title}>
    <caption>{title}</caption>
    <thead>
      <tr>
        <th>{m.updates_key()}</th>
        <th>{m.updates_change()}</th>
        <th>{m.updates_before()}</th>
        <th>{m.updates_after()}</th>
      </tr>
    </thead>
    <tbody>
      {#each update.settings as setting (setting.key)}
        <tr>
          <th scope="row">{setting.key}</th>
          <td>{CHANGES[setting.change]()}</td>
          <td>{bounds(setting.before)}</td>
          <td>{bounds(setting.after)}</td>
        </tr>
      {/each}
      {#each update.quantities as quantity (quantity.key)}
        <tr>
          <th scope="row">{quantity.key}</th>
          <td>{CHANGES[quantity.change]()}</td>
        </tr>
      {/each}
    </tbody>
  </table>
  <button disabled={pending} onclick={() => apply(update.id)}>
    {m.updates_apply({ id: update.id })}
  </button>
{/snippet}

<style>
  table {
    border-collapse: collapse;
  }

  caption {
    text-align: start;
    font-weight: bold;
  }

  th,
  td {
    padding: 0.25rem 0.5rem;
    text-align: start;
  }
</style>
