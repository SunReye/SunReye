<script lang="ts">
	import type { BatteryCapacityPoint } from '@SunReye/contracts/energy';
	import PeriodSeriesChart from './period-series-chart.svelte';
	import { dayMonthYear } from '$lib/format/date';
	import * as m from '$lib/paraglide/messages';

	// Every capacity the pack has been measured at, oldest first. One point per
	// deep discharge, so the x-axis is irregular by nature — a pack that was not
	// cycled deeply for a fortnight simply has no measurement from it, and
	// spacing the points evenly would be more honest than inventing the ones in
	// between.
	//
	// The scatter is the message as much as the slope is: these are measurements
	// of a quantity that genuinely varies with temperature and discharge rate,
	// and a single smooth line would claim a precision no single discharge has.
	let {
		trend,
		nameplateKwh = null
	}: {
		trend: BatteryCapacityPoint[];
		/** Rated capacity, drawn as the reference the points are read against. */
		nameplateKwh?: number | null;
	} = $props();

	type Row = { label: string; capacityKwh: number | null; nameplateKwh: number | null };

	const data = $derived<Row[]>(
		trend.map((p) => ({
			label: dayMonthYear(new Date(p.measuredAt)),
			capacityKwh: p.capacityKwh,
			nameplateKwh
		}))
	);

	const series = $derived([
		{
			key: 'capacityKwh',
			label: m.statistics_tile_battery_capacity(),
			color: 'var(--color-energy-battery)',
			value: (d: Row) => d.capacityKwh
		},
		// Only when it is known: a flat line at "nothing" is not a reference.
		...(nameplateKwh === null
			? []
			: [
					{
						key: 'nameplateKwh',
						label: m.battery_nameplate(),
						color: 'var(--color-muted-foreground)',
						value: (d: Row) => d.nameplateKwh
					}
				])
	]);

	const kwh = (v: unknown) =>
		v === null || v === undefined ? '—' : `${Number(v).toLocaleString(undefined, { maximumFractionDigits: 1 })} kWh`;
</script>

<!-- `overlay`: measurements compared against a reference on one plot, and a
     capacity is a level rather than something accrued over a bucket, so the line
     is the honest mark. -->
<PeriodSeriesChart {data} {series} kind="overlay" format={kwh} />
