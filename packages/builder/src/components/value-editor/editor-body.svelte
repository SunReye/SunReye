<!-- The value editor's body (ADR 21): header with rolling digits, wheel or list, apply. -->
<script lang="ts">
  import { haptics } from "@sunreye/ui/haptics";
  import { m } from "../../paraglide/messages.js";
  import { getLocale } from "../../paraglide/runtime.js";
  import ApplyBar from "./apply-bar.svelte";
  import {
    clock,
    fits,
    wheel,
    type Editable,
    type Outcome,
    type Refusal,
    type Refused,
  } from "./editable.ts";
  import EnumList from "./enum-list.svelte";
  import NumberDigits from "./number-digits.svelte";
  import RollingNumber from "./rolling-number.svelte";
  import TimeWheels from "./time-wheels.svelte";
  import Wheel from "./wheel.svelte";

  let {
    edit,
    current,
    onapply,
    refusal,
    compact = false,
  }: {
    edit: Editable;
    /** The device's value; `null` when unknown. */
    current: number | null;
    onapply: (value: number) => Promise<Outcome>;
    refusal?: Refusal | undefined;
    compact?: boolean;
  } = $props();

  // The editor is keyed by its setting; it edits the one it opened with.
  // svelte-ignore state_referenced_locally
  const orig = edit;

  // The value at open is the one Apply replaces; a tick while editing must not move it.
  // svelte-ignore state_referenced_locally
  const now = current;

  haptics.nudge();

  const nf = $derived(new Intl.NumberFormat(getLocale()));

  // Numbers.
  const numeric = orig.kind === "number" ? { edit: orig, rows: wheel(orig) } : undefined;
  const rows = numeric?.rows;
  const start = numeric ? numeric.rows.index(now ?? numeric.edit.min) : 0;
  let index = $state(start);
  let live = $state(start);

  // Times: an hour row and a minute row at the step.
  const step = orig.kind === "time" ? orig.step : 1;
  const opened = orig.kind === "time" ? (now ?? orig.min) : 0;
  const firstHour = Math.floor(opened / 60);
  const firstMinute = Math.round((opened % 60) / step);

  let hour = $state(firstHour);
  let minute = $state(firstMinute);
  let liveTime = $state({ hour: firstHour, minute: firstMinute * step });

  // Enums.
  let choice = $state(orig.kind === "enum" ? (now ?? orig.options[0]?.value ?? 0) : 0);

  const next = $derived.by(() => {
    if (rows) return rows.at(index);

    return orig.kind === "time" ? hour * 60 + minute * step : choice;
  });

  const changed = $derived(next !== now);

  function text(value: number | null): string {
    if (value === null) return "";

    if (orig.kind === "enum")
      return orig.options.find((o) => o.value === value)?.text ?? nf.format(value);

    if (orig.kind === "time") return clock(value);

    return orig.unit ? `${nf.format(value)} ${orig.unit}` : nf.format(value);
  }

  const nextText = $derived(text(next));

  /** What it may take: bounds and step, the minute step, or how many values. */
  function limits(): string {
    if (orig.kind === "number")
      return m.editor_limits({
        min: nf.format(orig.min),
        max: nf.format(orig.max),
        unit: orig.unit,
        step: nf.format(orig.step),
      });

    if (orig.kind === "time") return m.editor_minutes({ step: orig.step });

    return m.editor_values({ count: orig.options.length });
  }

  let pending = $state(false);
  let done = $state(false);

  /** A refusal or a mismatch stays beside its cause until the value changes (never a toast). */
  let problem = $state.raw<{ at: number; outcome: Refused }>();
  const shownProblem = $derived(problem?.at === next ? problem.outcome : undefined);

  async function apply(): Promise<void> {
    haptics.light();
    pending = true;
    const at = next;
    const outcome = await onapply(at);
    pending = false;

    if (outcome.kind === "confirmed") done = true;
    else problem = { at, outcome };
  }
</script>

<div class={["flex flex-col", compact ? "gap-3" : "gap-4"]}>
  <header class="flex flex-col items-center gap-1 text-center">
    <span class="text-sm font-medium">{orig.name}</span>
    <span class="text-xs text-muted-foreground tabular-nums">{limits()}</span>

    {#if numeric}
      <NumberDigits
        edit={numeric.edit}
        rows={numeric.rows}
        bind:index
        {live}
        {nf}
        text={nextText}
      />
    {:else if orig.kind === "time"}
      <span
        class="flex h-[64px] items-center text-5xl font-semibold tracking-tight"
        aria-label={nextText}
      >
        <RollingNumber value={liveTime.hour} max={23} pad={2} /><span
          class="-mt-1 px-0.5 text-muted-foreground"
        >
          :
        </span><RollingNumber value={liveTime.minute} max={59} pad={2} />
      </span>
    {:else}
      <span class="flex h-[48px] items-center text-2xl font-semibold tracking-tight">
        {nextText}
      </span>
    {/if}
  </header>

  <div data-vaul-no-drag>
    {#if numeric}
      <Wheel
        rows={numeric.rows}
        bind:index
        current={now === null ? undefined : numeric.rows.index(now)}
        format={(value) => nf.format(value)}
        unit={numeric.edit.unit}
        ariaLabel={numeric.edit.name}
        onlive={(p) => (live = Math.max(0, Math.min(numeric.rows.count - 1, p)))}
      />
    {:else if orig.kind === "time"}
      <TimeWheels
        step={orig.step}
        {now}
        bind:hour
        bind:minute
        onlive={(h, mm) => (liveTime = { hour: h, minute: mm })}
      />
    {:else if orig.kind === "enum"}
      <EnumList name={orig.name} options={orig.options} {now} bind:choice />
    {/if}
  </div>

  <ApplyBar
    nowText={text(now)}
    {nextText}
    {changed}
    {pending}
    {done}
    problem={shownProblem}
    {refusal}
    allowed={fits(orig, next)}
    onapply={apply}
  />
</div>
