<!-- A time of day on two momentum wheels, hours and minutes at the profile's step (ADR 21). -->
<script lang="ts">
  import { m } from "../../paraglide/messages.js";
  import type { Rows } from "./editable.ts";
  import Wheel from "./wheel.svelte";

  let {
    step,
    now,
    hour = $bindable(0),
    minute = $bindable(0),
    onlive,
  }: {
    /** Minutes; it divides an hour (ADR 5). */
    step: number;
    /** The device's value in minutes since midnight; `null` when unknown. */
    now: number | null;
    /** The hour row. */
    hour?: number;
    /** The minute row: minutes over `step`. */
    minute?: number;
    /** The fractional hour and minute while a wheel moves, for the rolling digits. */
    onlive: (hour: number, minute: number) => void;
  } = $props();

  function rows(count: number, by: number): Rows {
    return {
      count,
      at: (i) => i * by,
      index: (value) => Math.max(0, Math.min(count - 1, Math.round(value / by))),
    };
  }

  const hours = rows(24, 1);
  // The editor is keyed by its setting, so the step never changes.
  // svelte-ignore state_referenced_locally
  const minutes = rows(60 / step, step);

  let liveHour = hour;
  // svelte-ignore state_referenced_locally
  let liveMinute = minute * step;

  const two = (value: number) => String(value).padStart(2, "0");
</script>

<div class="flex items-center justify-center gap-2">
  <Wheel
    class="w-24"
    marker="dot"
    rows={hours}
    bind:index={hour}
    current={now === null ? undefined : Math.floor(now / 60)}
    format={two}
    ariaLabel={m.editor_hour()}
    onlive={(p) => {
      liveHour = Math.max(0, Math.min(23, p));
      onlive(liveHour, liveMinute);
    }}
  />
  <span class="text-2xl font-semibold text-muted-foreground">:</span>
  <Wheel
    class="w-24"
    marker="dot"
    rows={minutes}
    bind:index={minute}
    current={now === null ? undefined : minutes.index(now % 60)}
    format={two}
    ariaLabel={m.editor_minute()}
    onlive={(p) => {
      liveMinute = Math.max(0, Math.min(minutes.count - 1, p)) * step;
      onlive(liveHour, liveMinute);
    }}
  />
</div>
