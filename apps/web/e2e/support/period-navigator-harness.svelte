<script module lang="ts">
	import { mount } from 'svelte';
	import { setLocale } from '$lib/paraglide/runtime';
	import Self from './period-navigator-harness.svelte';

	/**
	 * A document holding ONE period navigator, mounted from a spec.
	 *
	 * The navigator is a control, not a page: the thing that has to be proven —
	 * tabs switching grain, the back arrow tiling one period onto the next, the
	 * forward arrow going dead on the current period, and a reopened calendar
	 * showing no stale selection — only exists once there is a scheduler and a
	 * portalled popover. `bun test` cannot run a rune (apps/web/TESTING.md).
	 *
	 * Both pages mount the control for real now, so this is no longer the ONLY
	 * way to drive it — it is kept because it pins the control's own contract:
	 * the `from`/`to` the page would fetch, read straight off the model, and a
	 * locale the spec can pin. /history reaches the same gestures but can only
	 * show them through a hundred cards' worth of chart mounts.
	 *
	 * So the spec mounts it itself. Vite dev serves this file (`server.fs.allow`
	 * in `vite.config.ts` names `e2e`), which is why the whole harness — the state
	 * the navigator writes into, the readouts the spec asserts on, and this mount
	 * entry point — is one `.svelte` file rather than a `.ts` beside one: a `.ts`
	 * in `e2e/` is type-checked by `bun run e2e:types` against a tsconfig that
	 * knows nothing about `svelte` or `$lib`.
	 */
	export function mountHarness(locale?: string): void {
		// Set BEFORE mounting: paraglide's message functions read the locale when
		// they are called, and the widest labels in the catalogue ("Settimana") are
		// the ones a 390px row has to survive.
		if (locale !== undefined) setLocale(locale as Parameters<typeof setLocale>[0], { reload: false });
		// The host page stays MOUNTED and is only hidden: unmounting a running
		// SvelteKit shell out from under its own effects is a source of console
		// noise that has nothing to do with the control being measured. Hidden
		// rather than left visible so a width measurement sees only the navigator.
		// The host div is appended after this loop, so iterating the live collection
		// is safe and oxlint's no-useless-spread applies.
		for (const node of document.body.children) {
			if (node instanceof HTMLElement) node.style.display = 'none';
		}
		const host = document.createElement('div');
		host.id = 'harness';
		document.body.append(host);
		mount(Self, { target: host });
	}
</script>

<script lang="ts">
	import PeriodNavigator from '$lib/components/inverter/period-navigator.svelte';
	import type { RangeOverride } from '$lib/components/inverter/period-navigator';
	import { customRange, resolvePreset } from '$lib/inverter/ranges';
	import { historyPresets } from '$lib/inverter/range-labels';
	import { browserTimeZone } from '$lib/time/browser-zone';
	import { liveClock } from '$lib/time/live-clock.svelte';
	import { periodWindow, type Period } from '$lib/time/period';

	// The zone is the browser's own, so "Today" and the calendar's `data-today`
	// cell agree about which day it is.
	const timeZone = browserTimeZone();

	// The presets /history keeps behind the calendar button, through the exact
	// function the page spends — the windows that are not calendar periods and so
	// have no tab. Filtering a preset table by a hand-kept id list here is what
	// this used to do, and it could agree with the spec while disagreeing with the
	// page; `ranges.test.ts` pins the four ids and `range-labels.test.ts` pins
	// that each carries a translation.
	const presets = historyPresets();

	let period = $state<Period>(periodWindow(new Date(), 'day', { timeZone }));
	let override = $state<RangeOverride | null>(null);
	/** The window the page would have fetched, so the spec can read the model. */
	let from = $state(period.start.toISOString());
	let to = $state(period.end.toISOString());

	function takePeriod(next: Period) {
		period = next;
		override = null;
		from = next.start.toISOString();
		to = next.end.toISOString();
	}
</script>

<PeriodNavigator
	{period}
	{override}
	{presets}
	{timeZone}
	now={liveClock.now}
	onPeriod={takePeriod}
	onPreset={(id) => {
		const range = resolvePreset(id);
		override = { id, label: range.label };
		from = range.from.toISOString();
		to = range.to.toISOString();
	}}
	onCustomRange={(start, end) => {
		const range = customRange(start, end, timeZone);
		override = { id: 'custom', label: range.label };
		from = range.from.toISOString();
		to = range.to.toISOString();
	}}
/>

<output data-testid="grain">{override === null ? period.grain : ''}</output>
<output data-testid="override">{override?.id ?? ''}</output>
<output data-testid="from">{from}</output>
<output data-testid="to">{to}</output>
