<!-- Controls' groups on the drill-in (ADR 21), or a note when no device declares a setting. -->
<script lang="ts">
  import DrillCard from "../components/drill-in/drill-card.svelte";
  import DrillIn from "../components/drill-in/drill-in.svelte";
  import { m } from "../paraglide/messages.js";
  import { getLocale } from "../paraglide/runtime.js";
  import ControlRows from "./ControlRows.svelte";
  import ControlsHeading from "./ControlsHeading.svelte";
  import ScheduleRows from "./ScheduleRows.svelte";
  import type { Outcome } from "../components/value-editor/editable.ts";
  import type { Control, ControlGroup } from "./groups.ts";
  import { drillGroups } from "./look.ts";

  let {
    groups,
    names,
    writes,
    open,
    onnavigate,
    value,
    text,
    editing,
    onedit,
    onset,
  }: {
    groups: readonly ControlGroup[];
    /** Each device's name, when more than one has settings. */
    names: ReadonlyMap<number, string>;
    /** Every device with settings has its writes on. */
    writes: boolean;
    open: string | null;
    onnavigate: (id: string | null) => void;
    value: (control: Control) => number | null;
    text: (control: Control) => string;
    editing: Control | null;
    onedit: (control: Control, row: HTMLElement) => void;
    /** Writes a control's value at once, as a switch does. */
    onset: (control: Control, value: number) => Promise<Outcome>;
  } = $props();
</script>

<main class="contents">
  {#if groups.length === 0}
    <div class="mx-auto flex w-full max-w-2xl flex-col gap-4 px-4 py-6">
      <ControlsHeading {writes} />
      <p class="px-1 text-sm text-muted-foreground">{m.controls_none()}</p>
    </div>
  {:else}
    <DrillIn
      groups={drillGroups(groups, value, getLocale())}
      {open}
      {onnavigate}
      back={m.controls_title()}
      label={m.controls_groups()}
    >
      {#snippet heading(level)}
        <ControlsHeading {writes} title={level === "root"} />
      {/snippet}
      {#snippet page(group)}
        {@const shown = groups.find((g) => g.id === group.id)}
        {#if shown?.id === "schedule"}
          <DrillCard>
            <ScheduleRows
              group={shown}
              {value}
              {text}
              owner={(c) => names.get(c.device)}
              {editing}
              {onedit}
              {onset}
            />
          </DrillCard>
        {:else if shown}
          <DrillCard>
            <ControlRows
              group={shown}
              {text}
              owner={(c) => names.get(c.device)}
              {editing}
              {onedit}
            />
          </DrillCard>
        {/if}
      {/snippet}
    </DrillIn>
  {/if}
</main>
