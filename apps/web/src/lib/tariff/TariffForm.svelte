<script lang="ts">
  import { untrack } from "svelte";
  import type { Core, Problem, Tariff } from "../api/core";
  import { problemText } from "../i18n/problems";
  import { m } from "../paraglide/messages.js";
  import { getLocale } from "../paraglide/runtime.js";
  import { changeOf, draftOf, instantOf } from "./draft";
  import ScheduleFields from "./ScheduleFields.svelte";

  let { core, tariff }: { core: Core; tariff: Tariff | undefined } = $props();

  const id = $props.id();

  // The admin's edit, seeded once from the tariff in force.
  let draft = $state(draftOf(untrack(() => tariff)));
  let answer = $state.raw<Tariff | Problem>();

  const instant = new Intl.DateTimeFormat(getLocale(), { dateStyle: "medium", timeStyle: "short" });

  /** Saves from now or the date given; reprices from the date given, even a past one. */
  async function save(event: SubmitEvent): Promise<void> {
    event.preventDefault();

    const from = instantOf(draft.appliesFrom);
    const change = changeOf(draft);

    answer =
      event.submitter?.getAttribute("name") === "reprice" && from !== undefined
        ? await core.reprice(from, change)
        : await core.changeTariff({ ...change, appliesFrom: from ?? null });
  }
</script>

<form onsubmit={save}>
  <ScheduleFields legend={m.tariff_import()} bind:schedule={draft.import} />
  <ScheduleFields legend={m.tariff_export()} bind:schedule={draft.export} />
  <label for="{id}-from">{m.tariff_applies_from()}</label>
  <input id="{id}-from" type="datetime-local" bind:value={draft.appliesFrom} />
  <button type="submit">{m.tariff_save()}</button>
  <button type="submit" name="reprice" disabled={draft.appliesFrom === ""}>
    {m.tariff_reprice()}
  </button>
</form>
{#if answer !== undefined}
  {#if "problem" in answer}
    <p role="alert">{problemText(answer.problem)}</p>
  {:else}
    <p role="status">
      {m.tariff_saved_from({ from: instant.format(Date.parse(answer.appliesFrom)) })}
    </p>
  {/if}
{/if}
