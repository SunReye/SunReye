<script lang="ts">
	import type { ComponentProps } from "svelte";
	import type RangeCalendar from "./range-calendar.svelte";
	import RangeCalendarMonthSelect from "./range-calendar-month-select.svelte";
	import RangeCalendarYearSelect from "./range-calendar-year-select.svelte";
	import { getLocalTimeZone, type DateValue } from "@internationalized/date";
	import { captionMonth, captionYear } from "./caption-format";

	let {
		captionLayout,
		months,
		monthFormat,
		years,
		yearFormat,
		month,
		locale,
		placeholder = $bindable(),
		monthIndex = 0,
		timeZone = getLocalTimeZone(),
	}: {
		captionLayout: ComponentProps<typeof RangeCalendar>["captionLayout"];
		months: ComponentProps<typeof RangeCalendarMonthSelect>["months"];
		monthFormat: ComponentProps<typeof RangeCalendarMonthSelect>["monthFormat"];
		years: ComponentProps<typeof RangeCalendarYearSelect>["years"];
		yearFormat: ComponentProps<typeof RangeCalendarYearSelect>["yearFormat"];
		month: DateValue;
		placeholder: DateValue | undefined;
		locale: string;
		monthIndex: number;
		/** The zone the range was built in; the caption reads its days there. */
		timeZone?: string;
	} = $props();

	const formatYear = (date: DateValue) => captionYear(date, yearFormat, locale, timeZone);
	const formatMonth = (date: DateValue) => captionMonth(date, monthFormat, locale, timeZone);
</script>

{#snippet MonthSelect()}
	<RangeCalendarMonthSelect
		{months}
		{monthFormat}
		value={month.month}
		onchange={(e) => {
			if (!placeholder) return;
			const v = Number.parseInt(e.currentTarget.value);
			const newPlaceholder = placeholder.set({ month: v });
			placeholder = newPlaceholder.subtract({ months: monthIndex });
		}}
	/>
{/snippet}

{#snippet YearSelect()}
	<RangeCalendarYearSelect {years} {yearFormat} value={month.year} />
{/snippet}

{#if captionLayout === "dropdown"}
	{@render MonthSelect()}
	{@render YearSelect()}
{:else if captionLayout === "dropdown-months"}
	{@render MonthSelect()}
	{#if placeholder}
		{formatYear(placeholder)}
	{/if}
{:else if captionLayout === "dropdown-years"}
	{#if placeholder}
		{formatMonth(placeholder)}
	{/if}
	{@render YearSelect()}
{:else}
	{formatMonth(month)} {formatYear(month)}
{/if}
