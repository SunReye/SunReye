<!-- The builder's time slider (ADR 20): a day and a time that move the sun; it scrubs, so it stays a slider (ADR 21). -->
<script lang="ts">
  import { Input } from "#lib/components/ui/input/index.js";
  import { m } from "../paraglide/messages.js";
  import type { Source } from "./moment.ts";

  let {
    day = $bindable(),
    minutes = $bindable(),
    source,
  }: {
    /** `YYYY-MM-DD` in the browser's calendar. */
    day: string;
    /** Since the day's midnight. */
    minutes: number;
    /** Undefined while the day loads. */
    source: Source | undefined;
  } = $props();

  const sources: Readonly<Record<Source, () => string>> = {
    measured: m.builder_source_measured,
    forecast: m.builder_source_forecast,
    clearSky: m.builder_source_clear_sky,
  };

  /** The last quarter hour of a day. */
  const LAST = 1425;

  const clock = $derived(
    [Math.floor(minutes / 60), minutes % 60].map((part) => String(part).padStart(2, "0")).join(":"),
  );
</script>

<div
  class="glass-ambient flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg px-3 py-2 ring-1 ring-border/60 elevation-1"
>
  <Input type="date" required aria-label={m.builder_day()} class="h-8 w-auto" bind:value={day} />
  <input
    type="range"
    min="0"
    max={LAST}
    step="15"
    aria-label={m.builder_time()}
    class="time min-w-32 flex-1"
    style:--filled="{(100 * minutes) / LAST}%"
    bind:value={minutes}
  />
  <span class="w-11 text-sm font-medium tabular-nums">{clock}</span>
  {#if source !== undefined}
    <span class="basis-full text-xs text-muted-foreground">{sources[source]()}</span>
  {/if}
</div>

<style>
  /* The registry slider's look on a native range, which keyboard, touch and form tests already know. */
  .time {
    height: 1rem;
    appearance: none;
    background: transparent;
    cursor: pointer;
  }

  .time:focus-visible {
    outline: none;
  }

  .time::-webkit-slider-runnable-track {
    height: 0.25rem;
    background: linear-gradient(to right, var(--primary) var(--filled), var(--muted) var(--filled));
    box-shadow: inset 0 0 0 1px var(--border);
  }

  .time::-moz-range-track {
    height: 0.25rem;
    background: var(--muted);
    box-shadow: inset 0 0 0 1px var(--border);
  }

  .time::-moz-range-progress {
    height: 0.25rem;
    background: var(--primary);
  }

  .time::-webkit-slider-thumb {
    width: 0.625rem;
    height: 1rem;
    margin-top: -0.375rem;
    appearance: none;
    border: 1px solid color-mix(in oklch, var(--foreground) 70%, transparent);
    border-radius: 2px;
    background: var(--card);
    transition: box-shadow var(--motion-fast) var(--motion-ease);
  }

  .time::-moz-range-thumb {
    width: 0.625rem;
    height: 1rem;
    border: 1px solid color-mix(in oklch, var(--foreground) 70%, transparent);
    border-radius: 2px;
    background: var(--card);
  }

  .time:hover::-webkit-slider-thumb,
  .time:focus-visible::-webkit-slider-thumb {
    box-shadow: 0 0 0 4px color-mix(in oklch, var(--ring) 50%, transparent);
  }
</style>
