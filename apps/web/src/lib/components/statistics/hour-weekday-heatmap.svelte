<script lang="ts">
	// Canvas layer: a 24×7 Cell grid renders far more cheaply than SVG and
	// sidesteps the >24-band INP freeze (see forecast-chart.svelte).
	import { Axis, Canvas, Cell, Chart, Tooltip } from 'layerchart/canvas';
	import { scaleBand } from 'd3-scale';
	import type { HeatmapCell } from 'server/src/statistics-calc';
	import { api } from '$lib/api';
	import RangeSwitcher from '$lib/components/inverter/range-switcher.svelte';
	import GradientLegend from '$lib/components/inverter/_shared/gradient-legend.svelte';
	import { heatColor, heatGradient, heatOpacity } from '$lib/statistics/heatmap';
	import { COST_X_TICK_SPACING } from '$lib/cost/ranges';
	import { decimal } from '$lib/format/number';
	import { getLocale } from '$lib/paraglide/runtime';
	import * as m from '$lib/paraglide/messages';

	// "When does this house actually use energy?" — the picked window folded onto
	// one week of hours. Every cell is an AVERAGE (the window's sum for that slot
	// divided by how many times the slot occurred), so a 3-day and a 90-day window
	// are read the same way.
	let { from, to }: { from: Date; to: Date } = $props();

	/** Metrics the server ships on every cell, so switching costs no request. */
	const METRICS = [
		{ id: 'loadKwh', label: m.energy_consumption() },
		{ id: 'importKwh', label: m.statistics_series_import() },
		{ id: 'exportKwh', label: m.chart_exported() },
		{ id: 'productionKwh', label: m.energy_production() }
	] as const;
	type MetricId = (typeof METRICS)[number]['id'];

	let metric = $state<MetricId>('loadKwh');
	let cells = $state<HeatmapCell[]>([]);

	$effect(() => {
		const query = { from: from.toISOString(), to: to.toISOString() };
		let cancelled = false;
		api.api.statistics.heatmap.get({ query }).then(({ data }) => {
			if (cancelled) return;
			cells = (data ?? []) as HeatmapCell[];
		});
		return () => {
			cancelled = true;
		};
	});

	/** One cell's average kWh for the selected metric. */
	const average = (c: HeatmapCell): number =>
		c.occurrences > 0 ? c[metric] / c.occurrences : 0;

	type Point = { hod: number; dow: number; avg: number };
	const points = $derived<Point[]>(cells.map((c) => ({ hod: c.hod, dow: c.dow, avg: average(c) })));

	const peak = $derived(points.reduce<number>((max, p) => Math.max(max, p.avg), 0));
	const hasData = $derived(peak > 0);

	/** Busiest slot — the sentence a screen reader gets instead of the grid. */
	const busiest = $derived(points.reduce<Point | null>((best, p) => (best && best.avg >= p.avg ? best : p), null));

	const hours = Array.from({ length: 24 }, (_, i) => i);

	// Only the weekdays the window actually covers. The server emits cells for
	// the (hour, weekday) slots that occurred, so a two-day window would
	// otherwise draw five labelled but permanently empty rows.
	const ALL_WEEKDAYS = [1, 2, 3, 4, 5, 6, 7];
	const weekdays = $derived.by(() => {
		const present = new Set(cells.map((c) => c.dow));
		return ALL_WEEKDAYS.filter((d) => present.has(d));
	});

	// ISO weekday → short local name. 2024-01-01 was a Monday, so day-of-month
	// and ISO weekday line up for the whole first week.
	const weekdayLabel = (dow: number) =>
		new Date(2024, 0, dow).toLocaleDateString(getLocale(), { weekday: 'short' });
	const hourLabel = (hod: number) => `${String(hod).padStart(2, '0')}:00`;
	const kwh = (v: number) => `${decimal(v, 2)} kWh`;

	const metricLabel = $derived(METRICS.find((x) => x.id === metric)?.label ?? '');

	// Row height, so a window covering two weekdays is a two-row strip rather
	// than two very tall cells.
	const gridHeight = $derived(Math.min(224, weekdays.length * 26 + 40));
</script>

<!-- No cell above zero means the window has no data for this metric at all —
     an all-surface grid would be a decorative empty component. -->
{#if hasData}
	<section class="flex flex-col gap-3 border border-border p-4">
		<div class="flex flex-wrap items-center justify-between gap-3">
			<div class="flex min-w-0 flex-col">
				<h2 class="text-sm font-medium uppercase tracking-wide text-muted-foreground">
					{m.statistics_heatmap_title()}
				</h2>
				<p class="text-xs text-muted-foreground/70">{m.statistics_heatmap_caption()}</p>
			</div>
			<RangeSwitcher options={METRICS} bind:value={metric} />
		</div>

		{#if busiest}
			<p class="sr-only">
				{m.statistics_heatmap_summary({
					metric: metricLabel,
					weekday: weekdayLabel(busiest.dow),
					hour: hourLabel(busiest.hod),
					amount: kwh(busiest.avg)
				})}
			</p>
		{/if}

		<!-- `band` mode gives every cell its own hit rect, which doubles as the
		     hover highlight: the rects sit in an SVG overlay above the canvas and
		     layerchart only sets `fill: transparent` at zero specificity, so a wash
		     of the foreground colour lands exactly on the cell under the pointer. -->
		<div
			style="height: {gridHeight}px"
			class="[&_.lc-tooltip-rect:hover]:fill-foreground/10"
			aria-hidden="true"
		>
			<Chart
				data={points}
				x="hod"
				xScale={scaleBand()}
				xDomain={hours}
				y="dow"
				yScale={scaleBand()}
				yDomain={weekdays}
				padding={{ left: 40, bottom: 24, top: 4, right: 8 }}
				tooltipContext={{ mode: 'band' }}
			>
				<Canvas>
					<Cell
						x="hod"
						y="dow"
						fill={(d: Point) => heatColor(d.avg / peak)}
						fillOpacity={(d: Point) => heatOpacity(d.avg / peak)}
						insets={{ all: 1 }}
						rx={2}
					/>
					<Axis
						placement="bottom"
						tickSpacing={COST_X_TICK_SPACING}
						format={hourLabel}
						rule={false}
					/>
					<Axis placement="left" format={weekdayLabel} rule={false} />
				</Canvas>

				<Tooltip.Root>
					{#snippet children({ data }: { data: Point })}
						<Tooltip.Header>
							{weekdayLabel(data.dow)}
							{hourLabel(data.hod)}
						</Tooltip.Header>
						<Tooltip.List>
							<Tooltip.Item label={metricLabel} value={kwh(data.avg)} />
						</Tooltip.List>
					{/snippet}
				</Tooltip.Root>
			</Chart>
		</div>

		<GradientLegend
			label={m.statistics_heatmap_legend()}
			low={kwh(0)}
			high={kwh(peak)}
			gradient={heatGradient()}
		/>
	</section>
{/if}
