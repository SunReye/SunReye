<script lang="ts">
	import { TOOLBAR_CONTROL_H_SM } from '$lib/layout/tokens';
	import CalendarBlank from 'phosphor-svelte/lib/CalendarBlank';
	import CaretLeft from 'phosphor-svelte/lib/CaretLeft';
	import CaretRight from 'phosphor-svelte/lib/CaretRight';
	import { getLocalTimeZone, type DateValue } from '@internationalized/date';
	import type { DateRange } from 'bits-ui';
	import { Button } from '$lib/components/ui/button';
	import * as Popover from '$lib/components/ui/popover';
	import { RangeCalendar } from '$lib/components/ui/range-calendar';
	import * as m from '$lib/paraglide/messages';
	import { getLocale } from '$lib/paraglide/runtime';
	import { browserTimeZone } from '$lib/time/browser-zone';
	import {
		canStepForward,
		containsNow,
		periodWindow,
		stepPeriod,
		switchGrain,
		weekStartFor,
		type Grain,
		type Period
	} from '$lib/time/period';
	import {
		activeGrain,
		GRAIN_ROW,
		grainTabs,
		navigatorTitle,
		stepLabels,
		type RangeOverride
	} from './period-navigator';

	// The dashboard's one range control.
	//
	//     ┌─────────────────────────────────────┐
	//     │  Day  │  Week  │  Month  │  Year    │
	//     ├─────────────────────────────────────┤
	//     │    ‹   📅 Today  ● Live     ›(off)  │
	//     └─────────────────────────────────────┘
	//
	// There is no fifth "Live" tab. Standing on the current period IS live, and
	// the DISABLED FORWARD ARROW is how the reader is told so — which is why the
	// title carries the live pill in the same breath: a dead arrow on its own
	// reads as broken, a dead arrow beside "Today ● Live" reads as the end of the
	// road. `e2e/period-navigator.spec.ts` drives all of it.
	//
	// One-way data flow, deliberately: the two pages that mount this hold ranges
	// of different shapes (`HistoryRange`, `CostRange`) and turn a `Period` into
	// their own through `historyRangeFor` / `costRangeFor`. So the control reports
	// what the reader asked for and owns none of it.
	let {
		period,
		override = null,
		presets = [],
		onPeriod,
		onPreset,
		onCustomRange,
		timeZone = browserTimeZone(),
		now
	}: {
		/** The calendar period the reader is standing on. */
		period: Period;
		/**
		 * A window that is NOT a calendar period — one of the kept presets, or a
		 * custom range. While one is showing it is what the title prints and no
		 * grain tab is lit.
		 */
		override?: RangeOverride | null;
		/** The presets THIS page keeps behind the calendar button, already localized. */
		presets?: readonly { id: string; label: string }[];
		/** The reader moved to a calendar period: a tab, or an arrow. */
		onPeriod: (period: Period) => void;
		/** The reader picked one of the kept presets. */
		onPreset: (id: string) => void;
		/** An arbitrary range. Both ends are INCLUSIVE calendar days. */
		onCustomRange: (start: Date, end: Date) => void;
		/** The zone the calendar is read in — the caller's choice (see issue #46). */
		timeZone?: string;
		/**
		 * The instant "live" is measured against. Every judgement this control
		 * makes is made against it: what the title says, whether the live pill is
		 * printed, whether the forward arrow is dead.
		 *
		 * REQUIRED, and it has to be A TICKING VALUE — `$lib/time/live-clock.svelte`
		 * is the app's. This prop carried `= new Date()` as its default, and a
		 * `$props()` default is evaluated once and cached: the clock stopped at
		 * mount, so a dashboard left open said "Today ● Live" at 03:00 while
		 * standing on yesterday, with the one arrow that could reach today
		 * disabled. Required rather than defaulted because the default WAS the bug
		 * — `bun run check` now refuses a caller that forgets, where a default
		 * handed them a stopped clock in silence. `e2e/navigator-midnight.spec.ts`
		 * drives it.
		 */
		now: Date;
	} = $props();

	const locale = $derived(getLocale());
	const opts = $derived({ timeZone, weekStartsOn: weekStartFor(locale) });

	// The words the model refuses to import: `$lib/time/period` and
	// `./period-navigator` are both catalogue-free on purpose.
	const messages = {
		day: m.range_grain_day,
		week: m.range_grain_week,
		month: m.range_grain_month,
		year: m.range_grain_year,
		today: m.range_today,
		weekOf: m.range_week_of,
		// One pair per grain, so an arrow says WHICH period it steps. A generic
		// "Previous period" is already the Records section's compare-mode button
		// on /statistics — see `stepLabels`.
		prev: {
			day: m.range_prev_day,
			week: m.range_prev_week,
			month: m.range_prev_month,
			year: m.range_prev_year
		},
		next: {
			day: m.range_next_day,
			week: m.range_next_week,
			month: m.range_next_month,
			year: m.range_next_year
		}
	};

	const tabs = $derived(grainTabs(messages));
	const lit = $derived(activeGrain(period, override));
	const title = $derived(
		navigatorTitle(period, override, { ...opts, locale, now }, messages)
	);
	/** The reader is on the period holding `now` — what the dead arrow announces. */
	const live = $derived(override === null && containsNow(period, now));
	/**
	 * May the reader step forward? On the current period, no: that is the live
	 * signal, and there is nothing past live. From an override, always — forward
	 * out of a six-hour window means "back to live", which is the one thing that
	 * must never be unreachable.
	 */
	const forwardable = $derived(override !== null || canStepForward(period, now));

	// The template holds no branches it does not have to — same reason
	// `range-switcher.svelte` states its variants here: a Svelte template is the
	// one place in this repo that cannot be unit-tested.
	const tabVariant = (id: Grain) => (lit === id ? ('default' as const) : ('ghost' as const));
	const presetVariant = (id: string) =>
		override?.id === id ? ('secondary' as const) : ('ghost' as const);
	const hasPresets = $derived(presets.length > 0);
	const forwardBlocked = $derived(!forwardable);
	/** The arrows' accessible names, which name the grain they step. */
	const arrows = $derived(stepLabels(period.grain, messages));

	function pickGrain(grain: Grain) {
		onPeriod(switchGrain(period, grain, now, opts));
	}

	function step(delta: number) {
		// Forward out of an override returns to the live period at the same grain,
		// rather than stepping a period the reader is no longer looking at.
		if (override !== null && delta > 0) onPeriod(periodWindow(now, period.grain, opts));
		else onPeriod(stepPeriod(period, delta, opts));
	}

	let open = $state(false);
	let custom = $state<DateRange>({ start: undefined, end: undefined });

	// THE STALE SELECTION. The control this replaces keeps its picked range in
	// component state across a close, so reopening paints the range that was
	// already applied and the next click lands on a COMPLETE range: bits-ui
	// restarts it, the effect below sees an incomplete range, and the selection
	// the user could see a moment ago silently disappears. Every open starts from
	// nothing. Pinned by `e2e/period-navigator.spec.ts`.
	$effect(() => {
		if (open) custom = { start: undefined, end: undefined };
	});

	// Fire once the user has picked both ends.
	$effect(() => {
		if (custom.start && custom.end) applyCustom(custom.start, custom.end);
	});

	function applyCustom(start: DateValue, end: DateValue) {
		const zone = getLocalTimeZone();
		onCustomRange(start.toDate(zone), end.toDate(zone));
		open = false;
	}

	function choosePreset(id: string) {
		onPreset(id);
		open = false;
	}
</script>

{#snippet popover()}
	<!-- Clamped to the width bits-ui reports, so the preset column wraps under
	     the calendar on a phone instead of sizing the popover to max-content. -->
	<div class="flex flex-col sm:flex-row">
		{#if hasPresets}
			<div class="flex flex-col gap-1 border-b p-2 sm:w-40 sm:border-b-0 sm:border-r">
				<span class="px-2 text-xs text-muted-foreground">{m.range_presets()}</span>
				<div class="flex flex-row flex-wrap gap-1 sm:flex-col">
					{#each presets as preset (preset.id)}
						<Button
							variant={presetVariant(preset.id)}
							size="sm"
							class="justify-start"
							onclick={() => choosePreset(preset.id)}
						>
							{preset.label}
						</Button>
					{/each}
				</div>
			</div>
		{/if}
		<!-- bits-ui defaults the calendar to en-US: without the app locale a German
		     UI shows "Su Mo Tu" and English day names in the aria labels. -->
		<RangeCalendar bind:value={custom} numberOfMonths={1} {locale} class="w-full sm:w-auto" />
	</div>
{/snippet}

<Popover.Root bind:open>
	<div
		data-slot="period-navigator"
		class="flex w-full flex-col border border-input sm:w-auto sm:flex-row sm:items-stretch {TOOLBAR_CONTROL_H_SM}"
	>
		<div class={GRAIN_ROW} role="group" aria-label={m.range_grain_aria()}>
			{#each tabs as tab (tab.id)}
				<Button
					variant={tabVariant(tab.id)}
					size="sm"
					class="h-9 sm:h-full rounded-none"
					onclick={() => pickGrain(tab.id)}
				>
					{tab.label}
				</Button>
			{/each}
		</div>
		<!-- One border-box as tall as a `size="sm"` outline button — 36px on a
		     phone, 32px from sm up — so the arrows and the trigger step together. -->
		<div
			class="flex h-9 sm:h-full items-center border-t border-input sm:border-t-0 sm:border-l"
			role="group"
			aria-label={m.range_select_aria()}
		>
			<Button
				variant="ghost"
				size="icon"
				class="h-full w-9 sm:w-8 rounded-none"
				onclick={() => step(-1)}
				aria-label={arrows.back}
			>
				<CaretLeft class="size-4" />
			</Button>
			<Popover.Trigger>
				{#snippet child({ props })}
					<Button
						{...props}
						variant="ghost"
						size="sm"
						class="h-full flex-1 gap-2 rounded-none border-x border-input sm:flex-none sm:px-3"
					>
						<CalendarBlank class="size-4" />
						{title}
						{#if live}
							<span class="flex items-center gap-1.5 text-muted-foreground">
								<span class="size-1.5 rounded-full bg-primary"></span>
								{m.status_live()}
							</span>
						{/if}
					</Button>
				{/snippet}
			</Popover.Trigger>
			<Button
				variant="ghost"
				size="icon"
				class="h-full w-9 sm:w-8 rounded-none"
				onclick={() => step(1)}
				disabled={forwardBlocked}
				aria-label={arrows.forward}
			>
				<CaretRight class="size-4" />
			</Button>
		</div>
	</div>
	<Popover.Content
		class="w-auto max-w-(--bits-popover-content-available-width) overflow-x-auto p-0"
		align="end"
	>
		{@render popover()}
	</Popover.Content>
</Popover.Root>
