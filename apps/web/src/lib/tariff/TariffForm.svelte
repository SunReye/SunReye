<script lang="ts">
  import { untrack } from "svelte";
  import { toast } from "svelte-sonner";
  import { Button } from "#lib/components/ui/button/index.js";
  import type { Core, Problem, Tariff } from "../api/core";
  import DateField from "../components/date-field.svelte";
  import ProblemAlert from "../components/problem-alert.svelte";
  import { m } from "../paraglide/messages.js";
  import { getLocale } from "../paraglide/runtime.js";
  import { changeOf, draftOf, instantOf } from "./draft";
  import ScheduleFields from "./ScheduleFields.svelte";

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
      toast.success(m.tariff_saved_from({ from: instant.format(Date.parse(answer.appliesFrom)) }));
    }
  }
</script>

<form class="flex flex-col" onsubmit={save}>
  <ScheduleFields legend={m.tariff_import()} bind:schedule={draft.import} />
  <ScheduleFields legend={m.tariff_export()} bind:schedule={draft.export} />
  <div class="mt-5 border-y border-border/60">
    <!-- From now, or from the plant's midnight of a picked day. -->
    <DateField
      variant="row"
      label={m.tariff_applies_from()}
      value={draft.appliesFrom.slice(0, 10)}
      shortcut={{ text: m.tariff_now(), value: "" }}
      onchange={(day) => {
        draft.appliesFrom = day === "" ? "" : `${day}T00:00`;
      }}
    />
  </div>
  <!-- A save is confirmed by a toast; a refusal stays here, beside what has to change. -->
  {#if answer !== undefined && "problem" in answer}
    <div class="px-4 pt-3"><ProblemAlert problem={answer.problem} /></div>
  {/if}
  <!-- Save stays in reach above the bar however long the bands run. -->
  <div
    class="glass-ambient sticky bottom-[calc(var(--bar-clear,0px)+0.75rem)] z-10 mx-2 mt-4 flex items-center gap-2 rounded-lg border border-border/60 p-2 elevation-2"
  >
    <Button
      type="submit"
      variant="ghost"
      name="reprice"
      disabled={draft.appliesFrom === ""}
      class="h-auto min-h-9 min-w-0 flex-1 justify-start text-left whitespace-normal"
    >
      {m.tariff_reprice()}
    </Button>
    <Button type="submit">{m.tariff_save()}</Button>
  </div>
</form>
