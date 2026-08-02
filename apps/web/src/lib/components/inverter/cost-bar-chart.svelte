<script lang="ts">
	import { BarChart } from 'layerchart';
	import * as Chart from '$lib/components/ui/chart';
	import * as m from '$lib/paraglide/messages';
	import ChartLegend from '$lib/components/inverter/chart-legend.svelte';
	import { costFormatters } from '$lib/cost/format';
	import TooltipSeriesRow from '$lib/components/inverter/_shared/tooltip-series-row.svelte';
	import { seriesConfig, stackedBarProps } from '$lib/components/inverter/_shared/chart-series';
	import { periodLabel, type CostBucket } from '$lib/cost/ranges';

	// One diverging stack per period. Mirrors the server's CostSeriesPoint
	// (apps/server/src/cost.ts): net = importCost − exportEarnings + standingCharge.
	type Point = {
		bucket: string;
		importCost: number;
		exportEarnings: number;
		standingCharge: number;
		net: number;
	};

	let {
		points,
		bucket,
		currency
	}: { points: Point[]; bucket: CostBucket; currency: string } = $props();

	// Costs stack upward (grid usage + the fixed standing charge), earnings pull
	// downward — so a period's bar shows what solar offsets and what it can't
	// (the connection fee + residual grid usage stay above the line). Hues follow
	// the energy-split chart: grid red = grid dependence, export blue = exported
	// production; standing teal is its own slot (all three CVD-validated,
	// dataviz skill).
	type Series = { key: string; label: string; color: string; value: (d: Point) => number | null };

	// An empty segment is left out of the stack rather than laid out at zero
	// height: `stackPadding` insets it by 1px per side, and the resulting negative
	// rect height is invalid SVG — the browser rejects the bar and logs.
	const nonZero = (v: number): number | null => (v === 0 ? null : v);

	const series: Series[] = [
		{
			key: 'importCost',
			label: m.chart_grid_usage(),
			color: 'var(--color-energy-grid)',
			value: (d) => nonZero(d.importCost)
		},
		{
			key: 'standingCharge',
			label: m.chart_standing_charge(),
			color: 'var(--color-cost-standing)',
			value: (d) => nonZero(d.standingCharge)
		},
		{
			key: 'exportEarnings',
			label: m.chart_export_earnings(),
			color: 'var(--color-energy-export)',
			value: (d) => nonZero(-d.exportEarnings)
		}
	];

	const config: Chart.ChartConfig = seriesConfig(series);

	const { money } = $derived(costFormatters(currency));

	// Earnings are already negative in the stack, so the sum of the tooltip rows is
	// the period's net — same figure as the Net cost tile.
	const netOf = (rows: readonly { value?: unknown }[]) =>
		rows.reduce((sum, p) => sum + Number(p.value ?? 0), 0);

	const data = $derived(points.map((p) => ({ ...p, label: periodLabel(p.bucket, bucket) })));
</script>

<div class="flex flex-col gap-3">
	<Chart.Container {config} class="h-64 w-full">
		<BarChart
			{data}
			x="label"
			{series}
			seriesLayout="stackDiverging"
			{...stackedBarProps(data.length)}
		>
			{#snippet tooltip()}
				<Chart.Tooltip>
					{#snippet formatter({ value, name, item, index, payload })}
						<TooltipSeriesRow {item} {name} value={money(Number(value))} />
						{#if index === payload.length - 1}
							<div
								class="mt-0.5 flex basis-full items-center justify-between gap-4 border-t border-border/50 pt-1.5 leading-none"
							>
								<span class="text-muted-foreground">{m.chart_net()}</span>
								<span class="font-mono font-medium tabular-nums text-foreground">
									{money(netOf(payload))}
								</span>
							</div>
						{/if}
					{/snippet}
				</Chart.Tooltip>
			{/snippet}
		</BarChart>
	</Chart.Container>
	<ChartLegend items={series} />
</div>
