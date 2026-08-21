<script lang="ts">
	import type { PeriodEnergy } from '@SunReye/contracts/energy';
	import PeriodSeriesChart from './period-series-chart.svelte';
	import { periodKeyLabel, type CostBucket } from '$lib/cost/ranges';
	import { decimal } from '$lib/format/number';
	import * as m from '$lib/paraglide/messages';

	// Every raw energy flow on one kWh axis, period by period: what came in, what
	// went out, what the house used and what the roof made — the "what actually
	// happened" chart behind the tile row.
	let {
		periods,
		bucket,
		/** Add the two battery flows. Capability gate: a plant without a pack must
		 *  not get two permanently-flat lines. */
		showBattery = false,
		onZoom,
		onResetZoom,
		zoomed = false
	}: {
		periods: PeriodEnergy[];
		bucket: CostBucket;
		showBattery?: boolean;
	/** Forwarded to the line chart: a drag selects positions, and the section
	 *  answers by refetching that window at a finer bucket. */
	onZoom?: (indices: [number, number]) => void;
	onResetZoom?: () => void;
	zoomed?: boolean;
	} = $props();

	type Row = PeriodEnergy & { label: string };

	const data = $derived<Row[]>(
		periods.map((p) => ({ ...p, label: periodKeyLabel(p.bucket, bucket) }))
	);

	// Hues are the app's validated energy set, used with their established
	// meanings: grid red, export blue, solar amber, and the battery magenta split
	// into a solid (out of the pack) and a surface-mixed (into the pack) pair —
	// same hue, so the pair stays CVD-safe and the legend carries the difference.
	//
	// No `value` accessors on purpose: the keys ARE the row fields, and a grouped
	// bar series is positioned with `x1 = series.value ?? series.key`, so an
	// accessor function would be handed to a band scale as its lookup key and
	// every bar would land at NaN. See the prop's doc in period-series-chart.
	const series = $derived([
		{
			key: 'importKwh',
			label: m.statistics_series_import(),
			color: 'var(--color-energy-grid)'
		},
		{
			key: 'exportKwh',
			label: m.chart_exported(),
			color: 'var(--color-energy-export)'
		},
		{
			key: 'loadKwh',
			label: m.energy_consumption(),
			color: 'var(--color-muted-foreground)'
		},
		{
			key: 'productionKwh',
			label: m.energy_production(),
			color: 'var(--color-energy-solar)'
		},
		...(showBattery
			? [
					{
						key: 'batteryDischargeKwh',
						label: m.statistics_series_battery_discharge(),
						color: 'var(--color-energy-battery)'
					},
					{
						key: 'batteryChargeKwh',
						label: m.statistics_series_battery_charge(),
						color: 'color-mix(in srgb, var(--color-energy-battery) 45%, var(--background))'
					}
				]
			: [])
	]);

	const kwh = (v: unknown) => `${decimal(Number(v))} kWh`;
</script>

<!-- `energy`: kWh accrued over each bucket, so the house mark is bars. A line
     between two bucket totals draws a rate the data does not carry, and the eye
     reads the area under it as a total. -->
<PeriodSeriesChart {data} {series} kind="energy" format={kwh} {onZoom} {onResetZoom} {zoomed} />
