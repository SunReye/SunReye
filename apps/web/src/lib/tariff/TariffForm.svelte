<script lang="ts">
  import { untrack } from "svelte";
  import type { Core, Problem, Tariff } from "../api/core";
  import ProblemAlert from "../components/problem-alert.svelte";
  import { confirmed } from "../feedback.ts";
  import { m } from "../paraglide/messages.js";
  import { getLocale } from "../paraglide/runtime.js";
  import { changeOf, draftOf, instantOf } from "./draft";
  import TariffSaveBar from "./TariffSaveBar.svelte";
  import ScheduleFields from "./ScheduleFields.svelte";
  import TermsFields from "./TermsFields.svelte";

  let { core, tariff }: { core: Core; tariff: Tariff | undefined } = $props();

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

    if (!("problem" in answer)) {
      confirmed(m.tariff_saved_from({ from: instant.format(Date.parse(answer.appliesFrom)) }));
    }
  }
</script>

<form class="flex flex-col" onsubmit={save}>
  <ScheduleFields legend={m.tariff_import()} bind:schedule={draft.import} />
  <ScheduleFields legend={m.tariff_export()} bind:schedule={draft.export} />
  <TermsFields
    bind:standingCharge={draft.standingCharge}
    bind:appliesFrom={draft.appliesFrom}
  />
  <!-- A save is confirmed by a toast; a refusal stays here, beside what has to change. -->
  {#if answer !== undefined && "problem" in answer}
    <div class="px-4 pt-3"><ProblemAlert problem={answer.problem} /></div>
  {/if}
  <TariffSaveBar dated={draft.appliesFrom !== ""} />
</form>
