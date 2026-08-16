<script lang="ts">
	import { fade } from 'svelte/transition';
	import { Skeleton } from '$lib/components/ui/skeleton';
	import Section from '$lib/components/layout/section.svelte';
	import MetricTooltipRow from '$lib/components/inverter/_shared/metric-tooltip-row.svelte';
	import MetricCardActions from '$lib/components/inverter/_shared/metric-card-actions.svelte';
	import MetricCardPlot from '$lib/components/inverter/_shared/metric-card-plot.svelte';
	import DraftChartFooter from '$lib/components/inverter/_shared/draft-chart-footer.svelte';
	import { api } from '$lib/api';
	import * as m from '$lib/paraglide/messages';
	import { inverter } from '$lib/inverter/store.svelte';
	import { inView } from '$lib/actions/in-view';
	import { FullscreenBox } from '$lib/charts/fullscreen.svelte';
	import { draftMetrics } from '$lib/inverter/chart-draft';
	import { tooltipLabel, xTick } from '$lib/inverter/chart-format';
	import type { HistoryRange } from '$lib/inverter/ranges';
	import type { ManifestMetric } from '$lib/inverter/types';

	let {
		metric,
		range,
		accent = 'var(--color-chart-2)',
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

	// ── Historical mode ─────────────────────────────────────────────────────────
	type Row = { time: string; avg: number; min: number; max: number };
	let rows = $state<Row[]>([]);
	let loading = $state(true);

	$effect(() => {
		if (!mounted || range.live) return;
		const query = {
			metric: metric.key,
			from: range.from.toISOString(),
			to: range.to.toISOString(),
			bucket: range.bucket,
			// A 7-day window renders as minute rollups (~10k points); cap high
			// enough that the ascending, limited query isn't truncated to the
			// oldest slice of the range.
			limit: 12000
		};
		let cancelled = false;
		loading = true;
		api.api.history.rollup.get({ query }).then(({ data }) => {
			if (cancelled) return;
			rows = (data ?? []) as Row[];
			loading = false;
		});
		return () => {
			cancelled = true;
		};
	});

	const chartData = $derived(rows.map((r) => ({ ...r, date: new Date(r.time) })));

	const labelFmt = (value: unknown) => tooltipLabel(range, value);
	const xTickFormat = (value: unknown) => xTick(range, value);

	const xDomain = $derived<[Date, Date]>([range.from, range.to]);
	/** True once the historical query has landed with rows to draw. */
	const plottable = $derived(!loading && chartData.length > 0);

	const enter = () => (visible = true);
	const leave = () => (visible = false);
</script>

<!-- The observer has to watch the card's outermost box, or a category of 100+
     charts mounts all at once — and `Section` takes neither a `class` nor a
     `use:` action, by design. So the root is a bare wrapper: no frame, no pad,
     nothing that would draw a second border around the card inside it.
     `nested` because every one of these sits inside a metric-group Section. -->
<div use:inView={{ onEnter: enter, onLeave: leave }}>
	<Section title={metric.label} nested fullscreen {screen}>
		{#snippet actions()}
			<MetricCardActions metricKey={metric.key} value={current} {unit} bind:draft />
		{/snippet}

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
					{unit}
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
