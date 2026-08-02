<script lang="ts">
	import CalendarBlank from 'phosphor-svelte/lib/CalendarBlank';
	import CaretLeft from 'phosphor-svelte/lib/CaretLeft';
	import CaretRight from 'phosphor-svelte/lib/CaretRight';
	import { getLocalTimeZone, type DateValue } from '@internationalized/date';
	import type { DateRange } from 'bits-ui';
	import { Button } from '$lib/components/ui/button';
	import * as Popover from '$lib/components/ui/popover';
	import * as m from '$lib/paraglide/messages';
	import { getLocale } from '$lib/paraglide/runtime';
	import { RangeCalendar } from '$lib/components/ui/range-calendar';

	// Presentational shell shared by the History and Costs range pickers: a trigger
	// button, a named-preset list, and a custom [from, to) calendar. It owns only
	// the popover/calendar UI state; the parent owns the range model and turns the
	// two callbacks into its own resolved range.
	//
	// When `onStep` is supplied the trigger becomes the centre of a segmented
	// control flanked by prev/next arrows (single-day stepping), so the picker and
	// stepper read as one control instead of two adjacent boxes.
	let {
		presets,
		activeId,
		triggerLabel,
		onPreset,
		onCustomRange,
		onStep,
		canStepForward = true
	}: {
		presets: readonly { id: string; label: string }[];
		activeId: string;
		triggerLabel: string;
		onPreset: (id: string) => void;
		/** Both ends are inclusive calendar days in local time. */
		onCustomRange: (start: Date, end: Date) => void;
		/** When set, render prev/next arrows around the trigger. `days` is ±1. */
		onStep?: (days: number) => void;
		/** Disable the forward arrow (e.g. already at today). */
		canStepForward?: boolean;
	} = $props();

	let open = $state(false);
	let custom = $state<DateRange>({ start: undefined, end: undefined });

	function choosePreset(id: string) {
		onPreset(id);
		open = false;
	}

	function applyCustom(start: DateValue, end: DateValue) {
		const tz = getLocalTimeZone();
		onCustomRange(start.toDate(tz), end.toDate(tz));
		open = false;
	}

	// Fire once the user has picked both ends of the custom range.
	$effect(() => {
		if (custom.start && custom.end) applyCustom(custom.start, custom.end);
	});
</script>

{#snippet content()}
	<!-- Clamp to the viewport space bits-ui reports so the preset row wraps on
	     mobile instead of sizing the popover to its single-line max-content. -->
	<div class="flex flex-col sm:flex-row">
		<div
			class="flex flex-row flex-wrap gap-1 border-b p-2 sm:w-40 sm:flex-col sm:border-b-0 sm:border-r"
		>
			{#each presets as p (p.id)}
				<Button
					variant={activeId === p.id ? 'secondary' : 'ghost'}
					size="sm"
					class="justify-start"
					onclick={() => choosePreset(p.id)}
				>
					{p.label}
				</Button>
			{/each}
		</div>
		<!-- Stacked (mobile) layout: stretch the calendar's fluid grid across the
		     popover; side-by-side it keeps its intrinsic width. -->
		<!-- bits-ui defaults the calendar to en-US: without the app locale a German
		     UI shows "Su Mo Tu" and English day names in the aria labels. -->
		<RangeCalendar
			bind:value={custom}
			numberOfMonths={1}
			locale={getLocale()}
			class="w-full sm:w-auto"
		/>
	</div>
{/snippet}

<Popover.Root bind:open>
	{#if onStep}
		<!-- Segmented control: arrows + trigger share one border-box, 32px tall to
		     match a `size="sm"` outline button. Corners squared, centre divided. -->
		<div class="flex h-8 items-center border border-input" role="group" aria-label={m.range_select_aria()}>
			<Button
				variant="ghost"
				size="icon"
				class="h-full w-8 rounded-none"
				onclick={() => onStep(-1)}
				aria-label={m.range_prev_day()}
			>
				<CaretLeft class="size-4" />
			</Button>
			<Popover.Trigger>
				{#snippet child({ props })}
					<Button
						{...props}
						variant="ghost"
						size="sm"
						class="h-full gap-2 rounded-none border-x border-input"
					>
						<CalendarBlank class="size-4" />
						{triggerLabel}
					</Button>
				{/snippet}
			</Popover.Trigger>
			<Button
				variant="ghost"
				size="icon"
				class="h-full w-8 rounded-none"
				onclick={() => onStep(1)}
				disabled={!canStepForward}
				aria-label={m.range_next_day()}
			>
				<CaretRight class="size-4" />
			</Button>
		</div>
	{:else}
		<Popover.Trigger>
			{#snippet child({ props })}
				<Button {...props} variant="outline" size="sm" class="gap-2">
					<CalendarBlank class="size-4" />
					{triggerLabel}
				</Button>
			{/snippet}
		</Popover.Trigger>
	{/if}
	<Popover.Content
		class="w-auto max-w-(--bits-popover-content-available-width) overflow-x-auto p-0"
		align="end"
	>
		{@render content()}
	</Popover.Content>
</Popover.Root>
