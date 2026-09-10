<script lang="ts">
	import { untrack } from 'svelte';
	import { source } from '$lib/source.svelte';
	import { fade } from 'svelte/transition';
	import { Skeleton } from '$lib/components/ui/skeleton';
	import Section from '$lib/components/layout/section.svelte';
	import PanelReadoutRow from '$lib/components/layout/panel-readout-row.svelte';
	import MetricTooltipRow from '$lib/components/inverter/_shared/metric-tooltip-row.svelte';
	import MetricReadout from '$lib/components/inverter/_shared/metric-readout.svelte';
	import MetricCompareMenu from '$lib/components/inverter/_shared/metric-compare-menu.svelte';
	import MetricCardPlot from '$lib/components/inverter/_shared/metric-card-plot.svelte';
	import DraftChartFooter from '$lib/components/inverter/_shared/draft-chart-footer.svelte';
	import { api } from '$lib/api';
	import * as m from '$lib/paraglide/messages';
	import { inverter } from '$lib/inverter/store.svelte';
	import { RETENTION_BAND, inView } from '$lib/actions/in-view';
	import { sharedMountQueue } from '$lib/actions/mount-queue';
	import { FullscreenBox } from '$lib/charts/fullscreen.svelte';
	import { draftMetrics } from '$lib/inverter/chart-draft';
	import { tooltipLabel, xTick } from '$lib/inverter/chart-format';
	import {
		dueRefresh,
		fetchWindow,
		liveTailPoints,
		mergeRollup,
		rollupPoints,
		type RollupRow
	} from '$lib/inverter/live-tail';
	import { liveClock } from '$lib/time/live-clock.svelte';
	import type { HistoryRange } from '$lib/inverter/ranges';
	import type { ManifestMetric } from '$lib/inverter/types';

	let {
		metric,
		range,
		accent = 'var(--chart-2)',
		onZoom,
		onResetZoom
	}: {
		metric: ManifestMetric;
		range: HistoryRange;
		accent?: string;
		/** A window drag-selected on this card's chart. The page answers it by
		 *  moving every card onto the finer range — see /history's `range`. */
		onZoom?: (next: HistoryRange) => void;
		onResetZoom?: () => void;
	} = $props();

	// Signed metrics (battery/grid power) split the fill red/green around zero.
	const diverging = $derived(!!metric.flow);
	const unit = $derived(metric.unit ?? '');

	// Lazy mount: only fetch/animate once scrolled near the viewport, and drop the
	// chart when it leaves so 100+ cards don't all run at once.
	let visible = $state(false);

	// Live current value from the store (updates on every WebSocket sample).
	const current = $derived(inverter.value(metric.key));

	// ── Draft overlay ───────────────────────────────────────────────────────────
	// Metrics pulled in on top of this card's own. Held here, on the card, and
	// nowhere else: it is one reader looking at one chart, so a store would make
	// every card share one draft.
	//
	// It lasts until the reader clears it or saves it — that is what "temporary"
	// means here, and the footer under the plot says so. It is deliberately NOT
	// discarded on leaving full screen: the control is in the header whether the
	// card is expanded or not, so a draft built on a card in the grid would be
	// thrown away by a gesture that has nothing to do with it.
	//
	// The card owns the FullscreenBox rather than letting Section keep its own,
	// because it still needs to READ the expanded state — see `mounted`.
	const screen = new FullscreenBox();
	let draft = $state<string[]>([]);

	const drafting = $derived(draft.length > 0);
	const overlay = $derived(draftMetrics(metric.key, draft));

	// Full screen mounts the chart whether or not the observer has fired. A card
	// taken to the whole screen is by definition the thing being looked at, and
	// once it is `fixed` its in-flow wrapper collapses to nothing — so the
	// observer that gates the lazy mount can never fire while it is expanded,
	// and a card expanded before it scrolled into view would stay a skeleton
	// with no way out of it.
	const mounted = $derived(visible || screen.expanded);

	// ── The window's rows ───────────────────────────────────────────────────────
	// EVERY range is fetched, the current day included. It used to be skipped
	// when `range.live`, and `metric-card-plot` answered that with the gliding
	// five-minute sparkline — so the Day tab standing on today showed the last
	// two minutes of the day it named (#216).
	let rows = $state<RollupRow[]>([]);
	let loading = $state(true);

	/** The clock minute the held rows were last brought up to. */
	let syncedTick = 0;

	/** The window being fetched, in the shape `$lib/inverter/live-tail` takes. */
	const span = $derived(fetchWindow(range));

	const rollupQuery = (from: Date, to: Date) => ({
		metric: metric.key,
		from: from.toISOString(),
		to: to.toISOString(),
		bucket: range.bucket,
		// A 7-day window renders as minute rollups (~10k points); cap high
		// enough that the ascending, limited query isn't truncated to the
		// oldest slice of the range.
		limit: 12000,
		...source.query
	});

	$effect(() => {
		if (!mounted) return;
		const query = rollupQuery(range.from, range.to);
		// Untracked: this is bookkeeping for the refresh below, and a tracked
		// read of the clock here would refetch the WHOLE window every minute.
		syncedTick = untrack(() => liveClock.now.getTime());
		let cancelled = false;
		loading = true;
		api.api.history.rollup.get({ query }).then(({ data }) => {
			if (cancelled) return;
			rows = (data ?? []) as RollupRow[];
			loading = false;
			syncedTick = liveClock.now.getTime();
		});
		return () => {
			cancelled = true;
		};
	});

	// ── Keeping a still-running window up to date ────────────────────────────────
	// A live range's right edge is the future, so the rows it holds go stale a
	// minute at a time. The window is fetched in full exactly once, above; this
	// asks only for the DELTA (`dueRefresh`, from the newest bucket held) and
	// merges it in.

	/** Worth refreshing at all: mounted, still filling in, and already loaded. */
	const appending = $derived(mounted && range.live && !loading);

	async function appendDelta(from: Date, to: Date, run: { cancelled: boolean }) {
		const { data } = await api.api.history.rollup.get({ query: rollupQuery(from, to) });
		const fresh = (data ?? []) as RollupRow[];
		if (run.cancelled || fresh.length === 0) return;
		rows = mergeRollup(rows, fresh);
	}

	// `liveClock` is the TICK and never the window. It is already coarsened to the
	// minute and driven by the live feed, so this costs no interval per card
	// (there are ~60 of them) and nothing on the ~1 Hz frames in between. What it
	// must NOT do is re-derive `range`, which is the PR #60 refetch loop — see the
	// comment on `range` in /history's `+page.svelte`.
	//
	// `rows` is read through `untrack` because this effect WRITES `rows`: a
	// tracked read makes the effect invalidate on its own answer, which is that
	// same loop one level down. `syncedTick` gates the first run, so landing the
	// initial fetch cannot itself trigger a second request.
	$effect(() => {
		if (!appending) return;
		const tick = liveClock.now.getTime();
		const delta = untrack(() => dueRefresh(rows, span, tick, syncedTick));
		if (!delta) return;
		syncedTick = tick;
		const run = { cancelled: false };
		void appendDelta(delta.from, delta.to, run);
		return () => {
			run.cancelled = true;
		};
	});

	// Live frames past the last fetched bucket, so the line reaches the present
	// between deltas even while the server's continuous aggregate lags. Keyed on
	// the minute tick and on `rows`, with the buffer itself read UNTRACKED: at
	// ~1 Hz across sixty cards, re-deriving a day of points per frame is the cost
	// the whole lazy-mount queue exists to avoid.
	const tail = $derived.by(() => {
		if (!range.live) return [];
		void liveClock.now;
		const held = rows;
		return untrack(() => liveTailPoints(inverter.series(metric.key), held, span));
	});

	const chartData = $derived([...rollupPoints(rows), ...tail]);

	const labelFmt = (value: unknown) => tooltipLabel(range, value);
	const xTickFormat = (value: unknown) => xTick(range, value);

	const xDomain = $derived<[Date, Date]>([range.from, range.to]);
	/** True once the historical query has landed with rows to draw. */
	const plottable = $derived(!loading && chartData.length > 0);

	// Entering the band only REQUESTS the mount. Wiring the observer straight to
	// `visible = true` meant a scroll sweep synchronously built a LayerChart for
	// every card it flew past — 59 mounts AND 59 unmounts in 12s, ~278ms of
	// construction each on a preset range. The queue admits work only once the
	// scroll settles, and `cancel` on the way out means a card merely passed
	// never builds at all. Shared across the grid so the per-frame budget is one
	// budget, not 63 of them.
	const queue = sharedMountQueue();
	const enter = () => queue.request(metric.key, () => (visible = true));
	const leave = () => {
		queue.cancel(metric.key);
		visible = false;
	};

	// The queue outlives the card — it is shared across the grid — so a request
	// still parked when this card is destroyed would run later and write
	// `visible` on a dead component. `leave` only fires when the OBSERVER says
	// so, which is not the same event: a collapsed category, a search that
	// filters this metric out, or leaving /history all destroy the card without
	// it ever leaving the viewport. Reading `metric.key` inside the cleanup does
	// not track it, so this effect runs its teardown exactly once, at destroy.
	$effect(() => () => queue.cancel(metric.key));
</script>

<!-- The observer has to watch the card's outermost box, or a category of 100+
     charts mounts all at once — and `Section` takes neither a `class` nor a
     `use:` action, by design. So the root is a bare wrapper: no frame, no pad,
     nothing that would draw a second border around the card inside it.
     `nested` because every one of these sits inside a metric-group Section. -->
<div
	use:inView={{
		onEnter: enter,
		onLeave: leave,
		rootMargin: RETENTION_BAND.mount,
		retainMargin: RETENTION_BAND.retain
	}}
>
	<Section title={metric.label} nested fullscreen {screen}>
		{#snippet actions()}
			<!-- Chrome only, because this card holds a plot: the compare menu is one
			     icon. It replaced an "add to chart" menu that stood here too — that
			     one answered a question ("which saved chart should own this?") you
			     can only ask if you already know what the chart is for, where
			     drafting answers the one actually in front of you ("what does this
			     look like next to that?") and ends at the same saved chart by way of
			     the editor. Not admin-gated, unlike the menu it replaced: overlaying
			     two metrics to look at them is a read.
			     Rendered unconditionally — gating it on `screen.expanded` is what
			     made the draft's lifetime a property of the full-screen gesture
			     rather than of the card. -->
			<MetricCompareMenu base={metric.key} bind:draft />
		{/snippet}

		<!-- The live reading, above the plot. It was the right half of the card's
		     own header row, then the section's header cluster; it is a value, not
		     chrome, so it reads left of the row the card's controls would use.
		     The two used to share one file, because a readout and a menu in one
		     `actions` snippet put this template over the complexity gate; they sit
		     in different zones now, so there is nothing left to group.

		     `animate` is the card's own visibility, and it must stay: this row
		     renders ABOVE the lazy-mount gate exactly as the header cluster did,
		     so all 63 cards would otherwise run a Tween whose 1150ms glide
		     outlasts the 1s feed — an rAF loop that never settles. Off screen it
		     snaps instead, still holding the latest value. -->
		<PanelReadoutRow value={reading} />

		{#if !mounted}
			<Skeleton class="h-50 w-full" />
		{:else}
			<!-- Fades in once the card scrolls into view; the wrapper persists across the
			     loading→data swap so the fade only plays on entry, not on every refetch. -->
			<div class="h-50 w-full" in:fade={{ duration: 300 }}>
				<MetricCardPlot
					{metric}
					{range}
					{accent}
					{diverging}
					{overlay}
					{drafting}
					data={chartData}
					{loading}
					{plottable}
					{xDomain}
					{xTickFormat}
					labelFormatter={labelFmt}
					{tooltipValue}
					{onZoom}
					{onResetZoom}
				/>
			</div>
		{/if}

		{#if drafting}
			<DraftChartFooter metrics={overlay} onClear={() => (draft = [])} />
		{/if}
	</Section>
</div>

{#snippet tooltipValue({ value }: { value: unknown })}
	<MetricTooltipRow label={metric.label} {value} {unit} />
{/snippet}

{#snippet reading()}
	<MetricReadout value={current} {unit} animate={mounted} />
{/snippet}
