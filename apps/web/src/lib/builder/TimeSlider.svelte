<!--
  The builder's time slider (ADR 20): a day and a time that move the sun, on one line. The day is
  picked on a calendar; the time scrubs, so it stays a slider (ADR 21).
-->
<script lang="ts">
  import DateField from "#lib/components/date-field.svelte";
  import { Slider } from "#lib/components/ui/slider/index.js";
  import { m } from "../paraglide/messages.js";
  import { today } from "./day.ts";

  let {
    day = $bindable(),
    minutes = $bindable(),
  }: {
    /** `YYYY-MM-DD` in the browser's calendar. */
    day: string;
    /** Since the day's midnight. */
    minutes: number;
  } = $props();

  /** The last quarter hour of a day. */
  const LAST = 1425;

  const clock = $derived(
    [Math.floor(minutes / 60), minutes % 60].map((part) => String(part).padStart(2, "0")).join(":"),
  );
</script>

<div
  role="group"
  aria-label={m.builder_moment()}
  class="canvas-chip flex h-11 items-center gap-2 rounded-lg pr-3 pl-1.5 ring-1 ring-border/60 elevation-1"
>
  <DateField
    variant="compact"
    label={m.builder_day()}
    value={day}
    shortcut={{ text: m.range_today(), value: today() }}
    onchange={(next) => {
      day = next;
    }}
  />
  <Slider
    type="single"
    min={0}
    max={LAST}
    step={15}
    aria-label={m.builder_time()}
    aria-valuetext={clock}
    class="h-11 min-w-0 flex-1"
    bind:value={minutes}
  />
  <span class="w-10 shrink-0 text-right text-sm font-medium tabular-nums">{clock}</span>
</div>
