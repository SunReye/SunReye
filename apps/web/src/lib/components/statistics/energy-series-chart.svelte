<script lang="ts">
	import type { PeriodEnergy } from 'server/src/energy-calc';
	import PeriodLineChart from './period-line-chart.svelte';
	import { periodLabel, type CostBucket } from '$lib/cost/ranges';
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
		showBattery = false
	}: { periods: PeriodEnergy[]; bucket: CostBucket; showBattery?: boolean } = $props();

	type Row = PeriodEnergy & { label: string };

	const data = $derived<Row[]>(
		periods.map((p) => ({ ...p, label: periodLabel(p.bucket, bucket) }))
	);

	// Hues are the app's validated energy set, used with their established
	// meanings: grid red, export blue, solar amber, and the battery magenta split
	// into a solid (out of the pack) and a surface-mixed (into the pack) pair —
	// same hue, so the pair stays CVD-safe and the legend carries the difference.
	const series = $derived([
		{
			key: 'importKwh',
			label: m.statistics_series_import(),
			color: 'var(--color-energy-grid)',
			value: (d: Row) => d.importKwh
		},
		{
			key: 'exportKwh',
			label: m.chart_exported(),
			color: 'var(--color-energy-export)',
			value: (d: Row) => d.exportKwh
		},
		{
			key: 'loadKwh',
			label: m.energy_consumption(),
			color: 'var(--color-muted-foreground)',
			value: (d: Row) => d.loadKwh
		},
		{
			key: 'productionKwh',
			label: m.energy_production(),
			color: 'var(--color-energy-solar)',
			value: (d: Row) => d.productionKwh
		},
		...(showBattery
			? [
					{
						key: 'batteryDischargeKwh',
						label: m.statistics_series_battery_discharge(),
						color: 'var(--color-energy-battery)',
						value: (d: Row) => d.batteryDischargeKwh
					},
					{
						key: 'batteryChargeKwh',
						label: m.statistics_series_battery_charge(),
						color: 'color-mix(in srgb, var(--color-energy-battery) 45%, var(--background))',
						value: (d: Row) => d.batteryChargeKwh
					}
				]
			: [])
	]);

	const kwh = (v: unknown) => `${decimal(Number(v))} kWh`;
</script>

<PeriodLineChart {data} {series} {bucket} format={kwh} />
