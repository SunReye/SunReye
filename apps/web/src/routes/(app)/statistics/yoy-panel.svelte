<script lang="ts">
	import { api } from '$lib/api';
	import * as m from '$lib/paraglide/messages';
	import RangeSwitcher from '$lib/components/inverter/range-switcher.svelte';
	import YoyChart from '$lib/components/statistics/yoy-chart.svelte';
	import Section from '$lib/components/layout/section.svelte';
	import PanelReadoutRow from '$lib/components/layout/panel-readout-row.svelte';
	import type { CostFormatters } from '$lib/cost/format';
	import { groupYoy, hasYoyData, type MonthlyValue } from '$lib/statistics/yoy';
	import type { CostPoint } from '$lib/statistics/sections';
	import { statisticsPrefs } from '$lib/statistics-prefs.svelte';
	import { getCustomizeSession } from '$lib/statistics/customize.svelte';

	// This year against last, month by month. Rangeless like the records above
	// it: one trailing 24-month window is fetched once, and switching metric
	// only re-folds what is already here.
	let { formatters }: { formatters: CostFormatters } = $props();

	const customize = getCustomizeSession();

	const METRICS = [
		{ id: 'net', label: m.statistics_yoy_metric_net() },
		{ id: 'production', label: m.statistics_yoy_metric_production() }
	] as const;
	type Metric = (typeof METRICS)[number]['id'];

	// Ephemeral for every viewer; its default is the saved preference, and an
	// admin's current pick becomes that default when they save the layout.
	let picked = $state<Metric | null>(null);
	const metric = $derived(picked ?? statisticsPrefs.optionFor('records').yoyMetric);
	function pick(next: Metric) {
		picked = next;
		if (customize.active) customize.draft.records.yoyMetric = next;
	}

	let netByMonth = $state<MonthlyValue[]>([]);
	let productionByMonth = $state<MonthlyValue[]>([]);

	// Trailing 24 calendar months so both charted years are complete.
	const now = new Date();
	const year = now.getFullYear();
	const seriesWindow = {
		from: new Date(year, now.getMonth() - 23, 1).toISOString(),
		to: now.toISOString(),
		bucket: 'month' as const
	};

	$effect(() => {
		let cancelled = false;
		void Promise.all([
			api.api.cost.series.get({ query: seriesWindow }),
			api.api.energy.series.get({ query: seriesWindow })
		]).then(([cost, energy]) => {
			if (cancelled) return;
			const costPoints = (cost.data ?? []) as CostPoint[];
			const energyPoints = (energy.data ?? []) as { bucket: string; productionKwh: number }[];
			netByMonth = costPoints.map((p) => ({ bucket: p.bucket, value: p.net }));
			productionByMonth = energyPoints.map((p) => ({
				bucket: p.bucket,
				value: p.productionKwh
			}));
		});
		return () => {
			cancelled = true;
		};
	});

	const rows = $derived(groupYoy(metric === 'net' ? netByMonth : productionByMonth, year));
	const format = $derived(metric === 'net' ? formatters.money : formatters.kwh);
	// Cost keeps the grid hue it carries elsewhere on the page; production the
	// solar one.
	const color = $derived(
		metric === 'net' ? 'var(--color-energy-grid)' : 'var(--color-energy-solar)'
	);
</script>

{#if hasYoyData(rows)}
	<!-- Was a hand-rolled `<section>` with an `<h3>` of its own — a seventh
	     section idiom on a page that shows the shared card everywhere else, and
	     the reason this was the one statistics chart with no full-screen
	     control. -->
	<Section title={m.statistics_yoy_title({ year })} nested fullscreen>
		<PanelReadoutRow {controls} />
		<YoyChart {rows} {year} {format} {color} />
	</Section>
{/if}

<!-- The metric switcher is the card's own control, not chrome: it carries two
     text labels and reads as a choice about the plot, so it sits in the row
     above it rather than in the header cluster, which on a card holding a plot
     is icons only. This panel has no headline figure, so the row's left cell is
     unspent and the switcher stays hard right. -->
{#snippet controls()}
	<!-- Function binding: the switcher stays uncontrolled, but a pick also lands
	     in the customize draft when an admin is editing. -->
	<RangeSwitcher options={METRICS} bind:value={() => metric, pick} label={m.range_select_metric_aria()} />
{/snippet}
