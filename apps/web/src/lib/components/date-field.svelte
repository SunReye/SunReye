<!--
  A calendar day, picked from the kit's Calendar in a popover: the trigger shows the day in the
  app's language, and days outside `min`–`max` cannot be picked. Days are ISO dates (2026-11-13).
-->
<script lang="ts">
  import { parseDate, type CalendarDate } from "@internationalized/date";
  import CalendarDays from "@lucide/svelte/icons/calendar-days";
  import { getLocale } from "../paraglide/runtime.js";
  import { cn } from "../utils.ts";
  import { buttonVariants } from "./ui/button/index.js";
  import { Calendar } from "./ui/calendar/index.js";
  import * as Popover from "./ui/popover/index.js";

  let {
    value,
    min,
    max,
    label,
    class: className,
    onchange,
  }: {
    value: string;
    min?: string;
    max?: string;
    /** The control's accessible name. */
    label: string;
    class?: string;
    onchange: (value: string) => void;
  } = $props();

  /** The days the calendar offers; unbounded on a side without one. */
  interface Limits {
    minValue?: CalendarDate;
    maxValue?: CalendarDate;
  }

  let open = $state(false);

  const day = $derived(parseDate(value));

  const limits = $derived.by(() => {
    const within: Limits = {};

    if (min !== undefined) within.minValue = parseDate(min);

    if (max !== undefined) within.maxValue = parseDate(max);

    return within;
  });

  const text = $derived(
    new Intl.DateTimeFormat(getLocale(), { dateStyle: "medium", timeZone: "UTC" }).format(
      day.toDate("UTC"),
    ),
  );
</script>

<Popover.Root bind:open>
  <Popover.Trigger
    aria-label={label}
    class={cn(
      buttonVariants({ variant: "outline", size: "sm" }),
      "justify-start font-normal tabular-nums",
      className,
    )}
  >
    <CalendarDays data-icon="inline-start" class="text-muted-foreground" />
    {text}
  </Popover.Trigger>
  <Popover.Content class="w-auto p-0" align="start">
    <Calendar
      type="single"
      value={day}
      {...limits}
      locale={getLocale()}
      onValueChange={(next) => {
        if (next === undefined) return;

        open = false;
        onchange(next.toString());
      }}
    />
  </Popover.Content>
</Popover.Root>
