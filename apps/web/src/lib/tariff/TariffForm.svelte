<script lang="ts">
  import { untrack } from "svelte";
  import { toast } from "svelte-sonner";
  import { Button } from "#lib/components/ui/button/index.js";
  import { Input } from "#lib/components/ui/input/index.js";
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

    if (!("problem" in answer)) {
      toast.success(m.tariff_saved_from({ from: instant.format(Date.parse(answer.appliesFrom)) }));
    }
  }
</script>

<form class="flex flex-col gap-6" onsubmit={save}>
  <ScheduleFields legend={m.tariff_import()} bind:schedule={draft.import} />
  <ScheduleFields legend={m.tariff_export()} bind:schedule={draft.export} />
  <label class="flex flex-col gap-1.5 text-sm" for="{id}-from">
    {m.tariff_applies_from()}
    <Input id="{id}-from" type="datetime-local" class="w-56" bind:value={draft.appliesFrom} />
  </label>
  <div class="flex flex-wrap gap-2">
    <Button type="submit">{m.tariff_save()}</Button>
    <Button type="submit" variant="outline" name="reprice" disabled={draft.appliesFrom === ""}>
      {m.tariff_reprice()}
    </Button>
  </div>
</form>
<!-- A save is confirmed by a toast; a refusal stays here, beside what has to change. -->
{#if answer !== undefined && "problem" in answer}
  <p role="alert">{problemText(answer.problem)}</p>
{/if}
