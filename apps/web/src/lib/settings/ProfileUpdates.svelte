<script lang="ts">
  import Refusal, { answered } from "../setup/Refusal.svelte";
  import type { Core, Declared, Problem, Update } from "../api/core";
  import { m } from "../paraglide/messages.js";
  import { Button } from "#lib/components/ui/button/index.js";
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
    problem = "problem" in answer ? answered(answer) : undefined;
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
    <section
      aria-labelledby="updates-title"
      class="drill-card flex flex-col gap-3 border-t border-border/60 p-4 drill:mt-4"
    >
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
  <div class="px-4"><Refusal refused={problem} /></div>
{/if}

{#snippet diff(update: Update)}
  {@const title = m.updates_profile({ id: update.id, from: update.from, to: update.to })}
  <div class="flex flex-col gap-2">
    <h4 class="text-sm font-medium">{title}</h4>
    <ul aria-label={title} class="divide-y divide-border/60 rounded-md border border-border/60">
      {#each update.settings as setting (setting.key)}
        <li class="flex flex-col gap-0.5 px-3 py-2">
          <span class="text-[15px]">{settingLabel(setting)}</span>
          <span class="text-sm text-muted-foreground">
            {CHANGES[setting.change]()} · {bounds(setting.before)} → {bounds(setting.after)}
          </span>
        </li>
      {/each}
      {#each update.quantities as quantity (quantity.key)}
        <li class="flex flex-col gap-0.5 px-3 py-2">
          <span class="text-[15px]">{settingLabel(quantity)}</span>
          <span class="text-sm text-muted-foreground">{CHANGES[quantity.change]()}</span>
        </li>
      {/each}
    </ul>
    <Button class="self-start" disabled={pending} onclick={() => apply(update.id)}>
      {m.updates_apply({ id: update.id })}
    </Button>
  </div>
{/snippet}
