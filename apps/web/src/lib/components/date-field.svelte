<!--
  A calendar day, picked from the kit's Calendar in a popover with a mouse and a bottom drawer on
  touch (ADR 21): the trigger shows the day in the app's language, and days outside `min`–`max`
  cannot be picked. Days are ISO dates (2026-11-13).

  `field` is an outlined button; `compact` a ghost one that drops this year and steps years from
  dropdowns; `row` a settings row under its label.
-->
<script lang="ts">
  import { CalendarDate, parseDate, type DateValue } from "@internationalized/date";
  import CalendarDays from "@lucide/svelte/icons/calendar-days";
  import { getLocale } from "../paraglide/runtime.js";
  import { input } from "../shell/input.svelte.ts";
  import { Button, buttonVariants } from "@sunreye/ui/button";
  import DrawerSheet from "./drawer-sheet.svelte";
  import { Calendar } from "@sunreye/ui/calendar";
  import * as Item from "@sunreye/ui/item";
  import { FEEDBACK, SELECTED } from "@sunreye/ui/pressable";
  import * as Popover from "@sunreye/ui/popover";

  let {
    value,
    min,
    max,
    label,
    variant = "field",
    shortcut,
    class: className,
    onchange,
  }: {
    /** Empty for no day: a field that only picks, or one with an empty `shortcut`. */
    value: string;
    min?: string;
    max?: string;
    /** The control's accessible name; a row shows it. */
    label: string;
    variant?: "field" | "compact" | "row";
    /**
     * A value one tap away, below the calendar. An empty one clears the day: the trigger then reads
     * its text, and picking the picked day again clears too.
     */
    shortcut?: { text: string; value: string };
    class?: string;
    onchange: (value: string) => void;
  } = $props();

  /** How far a compact calendar's years reach back and ahead of today. */
  const BACK = 20;
  const AHEAD = 10;

  /** What differs between the variants; a row's trigger is its own markup. */
  const LOOKS = {
    field: {
      button: "outline",
      trigger: "justify-start font-normal",
      icon: "text-muted-foreground",
      content: "w-auto p-0",
      align: "start",
      caption: "label",
      foot: "border-t border-border/60 p-2",
      shortcut: "w-full",
    },
    compact: {
      button: "ghost",
      trigger: "shrink-0",
      icon: "",
      content: "w-auto gap-2 p-2",
      align: "start",
      caption: "dropdown",
      foot: "contents",
      shortcut: "self-start",
    },
    row: {
      button: "outline",
      trigger: "",
      icon: "",
      content: "w-auto p-0",
      align: "end",
      caption: "label",
      foot: "border-t border-border/60 p-2",
      shortcut: "w-full",
    },
  } as const;

  /** The picked day and the days the calendar offers; unbounded on a side without a limit. */
  interface Shown {
    value?: CalendarDate;
    minValue?: CalendarDate;
    maxValue?: CalendarDate;
  }

  let open = $state(false);

  const locale = getLocale();
  const thisYear = new Date().getFullYear();

  const look = $derived(LOOKS[variant]);
  const day = $derived(value === "" ? undefined : parseDate(value));

  const shown = $derived.by(() => {
    const within: Shown = {};

    if (day !== undefined) within.value = day;

    if (min !== undefined) within.minValue = parseDate(min);

    if (max !== undefined) within.maxValue = parseDate(max);

    // The year dropdown lists the years between the limits, so a compact calendar always has both.
    if (variant === "compact") {
      const year = day?.year ?? thisYear;

      within.minValue ??= new CalendarDate(Math.min(year, thisYear - BACK), 1, 1);
      within.maxValue ??= new CalendarDate(Math.max(year, thisYear + AHEAD), 12, 31);
    }

    return within;
  });

  function written(options: Intl.DateTimeFormatOptions): string {
    return day === undefined
      ? (shortcut?.text ?? "")
      : new Intl.DateTimeFormat(locale, { ...options, timeZone: "UTC" }).format(day.toDate("UTC"));
  }

  const text = $derived.by(() => {
    if (variant !== "compact") return written({ dateStyle: "medium" });

    const short: Intl.DateTimeFormatOptions = { day: "numeric", month: "short" };

    // The year only where it is not this one: the button stays short.
    if (day?.year !== thisYear) short.year = "2-digit";

    return written(short);
  });

  /** A compact button drops the year, so its name carries the whole day, if it holds one. */
  const named = $derived(
    variant === "compact" && day !== undefined
      ? `${label}: ${written({ dateStyle: "long" })}`
      : label,
  );

  // An empty value has no day on the calendar to show it is picked, so its shortcut stays live.
  const rests = $derived(shortcut !== undefined && value !== "" && shortcut.value === value);

  function pick(next: string): void {
    open = false;
    onchange(next);
  }

  function picked(next: DateValue | undefined): void {
    if (next !== undefined) pick(next.toString());
    else if (shortcut?.value === "") pick("");
  }
</script>

<Popover.Root bind:open>
  {#if variant === "row"}
    <Item.Root class="rounded-none border-0">
      {#snippet child({ props })}
        <Popover.Trigger
          {...props}
          class={[props.class, "flex-nowrap text-left", FEEDBACK, open && SELECTED, className]}
        >
          <Item.Content class="min-w-0">
            <Item.Title class="text-[15px] font-normal">{label}</Item.Title>
          </Item.Content>
          <Item.Actions class="gap-2 text-[15px] font-medium tabular-nums">
            {text}
            <CalendarDays class="size-4 text-muted-foreground" />
          </Item.Actions>
        </Popover.Trigger>
      {/snippet}
    </Item.Root>
  {:else}
    <Popover.Trigger
      aria-label={named}
      class={buttonVariants({
        variant: look.button,
        size: "sm",
        class: [look.trigger, "tabular-nums", className],
      })}
    >
      <CalendarDays data-icon="inline-start" class={look.icon} />
      {text}
    </Popover.Trigger>
  {/if}
  <!-- On touch the trigger opens the drawer below. -->
  {#if input.overlay === "popover"}
    <Popover.Content class={look.content} align={look.align}>
      {@render calendar()}
    </Popover.Content>
  {/if}
</Popover.Root>

{#if input.overlay === "drawer"}
  <DrawerSheet bind:open {label} titled>
    <div class="flex flex-col">
      {@render calendar()}
    </div>
  </DrawerSheet>
{/if}

{#snippet calendar()}
  <Calendar
    class="mx-auto"
    type="single"
    calendarLabel={label}
    captionLayout={look.caption}
    {...shown}
    {locale}
    onValueChange={picked}
  />
  {#if shortcut !== undefined}
    {@const to = shortcut.value}
    <div class={look.foot}>
      <Button
        variant="ghost"
        size="sm"
        class={look.shortcut}
        disabled={rests}
        onclick={() => {
          pick(to);
        }}>{shortcut.text}</Button
      >
    </div>
  {/if}
{/snippet}
