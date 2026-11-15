<!-- A calendar day as a button that opens a calendar; a picked day closes it (ADR 21). -->
<script lang="ts">
  import CalendarDays from "@lucide/svelte/icons/calendar-days";
  import { CalendarDate } from "@internationalized/date";
  import { Button } from "#lib/components/ui/button/index.js";
  import { Calendar } from "#lib/components/ui/calendar/index.js";
  import * as Popover from "#lib/components/ui/popover/index.js";
  import { m } from "../paraglide/messages.js";
  import { getLocale } from "../paraglide/runtime.js";
  import { now, parts, today, written } from "./day.ts";

  let {
    value = $bindable(),
    label,
  }: {
    /** `YYYY-MM-DD` in the browser's calendar. */
    value: string;
    label: string;
  } = $props();

  /** How far the calendar's years reach back and ahead of today. */
  const BACK = 20;
  const AHEAD = 10;

  let open = $state(false);

  const locale = getLocale();
  const current = now();
  const picked = $derived(parts(value) ?? current);
  const local = $derived(new Date(picked.year, picked.month - 1, picked.day));

  // The year only where it is not this one: the button stays short.
  const short = $derived(
    new Intl.DateTimeFormat(
      locale,
      picked.year === current.year
        ? { day: "numeric", month: "short" }
        : { day: "numeric", month: "short", year: "2-digit" },
    ).format(local),
  );

  const long = $derived(new Intl.DateTimeFormat(locale, { dateStyle: "long" }).format(local));
</script>

<Popover.Root bind:open>
  <Popover.Trigger>
    {#snippet child({ props })}
      <Button
        {...props}
        variant="ghost"
        size="sm"
        aria-label="{label}: {long}"
        class="shrink-0 tabular-nums"
      >
        <CalendarDays data-icon="inline-start" />
        {short}
      </Button>
    {/snippet}
  </Popover.Trigger>
  <Popover.Content align="start" class="w-auto gap-2 p-2">
    <Calendar
      type="single"
      calendarLabel={label}
      {locale}
      captionLayout="dropdown"
      minValue={new CalendarDate(Math.min(picked.year, current.year - BACK), 1, 1)}
      maxValue={new CalendarDate(Math.max(picked.year, current.year + AHEAD), 12, 31)}
      bind:value={
        () => new CalendarDate(picked.year, picked.month, picked.day),
        (day) => {
          if (day === undefined) return;

          value = written(day);
          open = false;
        }
      }
    />
    <Button
      variant="ghost"
      size="sm"
      class="self-start"
      disabled={value === today()}
      onclick={() => {
        value = today();
        open = false;
      }}>{m.range_today()}</Button
    >
  </Popover.Content>
</Popover.Root>
