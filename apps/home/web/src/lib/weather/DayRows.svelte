<!--
  A day's rows under the sky by three hours (ADR 23 "Dashboard"): the weather code's icon and the
  clock time over the hours, then the rows on the same span. Under the pointer, or a finger held on
  it, one rule crosses every row at its slot, which `read` gives the rows to say their value there
  (ADR 21 "Chart reading"). A faint rule marks now.
-->
<script lang="ts">
  import type { Snippet } from "svelte";
  import ChartReading from "../detail/ChartReading.svelte";
  import { getLocale } from "../paraglide/runtime.js";
  import HourMarks from "./HourMarks.svelte";
  import type { Hour } from "./hourly.ts";
  import SkyIcon from "./SkyIcon.svelte";

  let {
    hours,
    span,
    zone,
    now,
    slots = hours.length,
    read = $bindable(null),
    children,
  }: {
    hours: readonly Hour[];
    /** The day, ms since 1970. */
    span: readonly [number, number];
    zone: string;
    /** ms since 1970. */
    now: number;
    /** How many equal slots the rows are read in; the hours unless they draw finer. */
    slots?: number;
    /** The index of the slot being read; null with none. */
    read?: number | null;
    children: Snippet;
  } = $props();

  const clock = $derived(
    new Intl.DateTimeFormat(getLocale(), { hour: "2-digit", minute: "2-digit", timeZone: zone }),
  );

  /** The hour the slot being read is in, which the marks follow. */
  const readHour = $derived(read === null ? null : Math.floor((read * hours.length) / slots));

  /** Where now is across the day, in %; null on another day. */
  const nowAt = $derived(
    now >= span[0] && now < span[1] ? ((now - span[0]) / (span[1] - span[0])) * 100 : null,
  );
</script>

<ChartReading {slots} bind:read class="flex flex-col gap-4" data-hours>
  <HourMarks {hours} {span} read={readHour} class="h-10">
    {#snippet mark(hour, marks)}
      {#if hour.sky}
        <SkyIcon sky={hour.sky} class="size-5" />
      {:else}
        <span class="size-5"></span>
      {/if}
      <span
        class={[
          "text-[11px] tabular-nums",
          marks ? "font-medium text-foreground" : "text-muted-foreground",
        ]}
      >
        {clock.format(hour.at)}
      </span>
    {/snippet}
  </HourMarks>

  {@render children()}

  {#if nowAt !== null}
    <span
      class="pointer-events-none absolute inset-y-0 w-px bg-foreground/25"
      style:left="{nowAt}%"
      data-now
    ></span>
  {/if}
</ChartReading>
