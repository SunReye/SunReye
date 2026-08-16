<script lang="ts">
	import type { Component } from 'svelte';
	import Sun from 'phosphor-svelte/lib/Sun';
	import House from 'phosphor-svelte/lib/House';
	import ArrowLineUp from 'phosphor-svelte/lib/ArrowLineUp';
	import ArrowLineDown from 'phosphor-svelte/lib/ArrowLineDown';
	import type { CanonicalRole, ManifestMetric } from '$lib/inverter/types';
	import { inverter } from '$lib/inverter/store.svelte';
	import { api } from '$lib/api';
	import { payloadOrNull } from '$lib/api-payload';
	import * as m from '$lib/paraglide/messages';
	import EnergyDetailDialog from './energy-detail-dialog.svelte';
	import EnergyHeadline from './_shared/energy-headline.svelte';
	import KpiSlotRow from './_shared/kpi-slot-row.svelte';
	import KpiMeter from './_shared/kpi-meter.svelte';

	// Per-card detail dialog: which stacked-bar chart the tile opens, plus its
	// title. Keyed by role; only the four energy roles map a variant.
	const DETAIL: Record<
		string,
		{ variant: 'consumption' | 'production' | 'feedin' | 'purchase'; title: () => string }
	> = {
		'production.today': { variant: 'production', title: m.overview_detail_production },
		'load.energy.today': { variant: 'consumption', title: m.overview_detail_consumption },
		'grid.energy.exported.today': { variant: 'feedin', title: m.overview_detail_feed_in },
		'grid.energy.imported.today': { variant: 'purchase', title: m.overview_detail_purchase }
	};

	// Card surface + interactive/focus affordances. The whole tile is the dialog
	// trigger (a <button>), so it gets Enter/Space activation for free.
	const CARD_CLASS =
		'flex w-full flex-col gap-2 rounded-xl border border-border/60 bg-card p-3 text-left transition-colors hover:border-border hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:p-4';

	// The slice of /api/cost?range=today the cards render: money that flowed
	// through the meter plus the two ratio KPIs the server already derives.
	type CostToday = {
		currency: string;
		importCost: number;
		exportEarnings: number;
		/** Value of self-consumed solar: (load − import) priced at the grid rate. */
		solarSavings: number;
		/** (load − import) / load — autarky. */
		selfSufficiency: number | null;
		/** (production − export) / production. */
		selfConsumption: number | null;
	};

	let cost = $state<CostToday | null>(null);

	// The kWh headlines stream live over the WebSocket; the €/% figures come
	// from a rollup query, so poll once a minute (cheap, feels live on a wall
	// display) and resync when the tab becomes visible again. Failures (e.g.
	// tariff endpoint unavailable) simply leave the KPI rows off.
	$effect(() => {
		let stop = false;
		const load = async () => {
			const { data } = await api.api.cost.get({ query: { range: 'today' } });
			if (!stop) cost = payloadOrNull<CostToday>(data);
		};
		load();
		const id = setInterval(load, 60 * 1000);
		const onVisible = () => document.visibilityState === 'visible' && load();
		document.addEventListener('visibilitychange', onVisible);
		return () => {
			stop = true;
			clearInterval(id);
			document.removeEventListener('visibilitychange', onVisible);
		};
	});

	const money = (v: number, currency: string) =>
		new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(v);
	const percent = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 100);

	/**
	 * Secondary KPIs per card. Every card renders the same three-slot skeleton
	 * (ratio row, meter bar, money row) so the rows line up across the strip;
	 * slots a card doesn't use stay invisible but keep their height.
	 */
	type CardKpis = {
		ratio?: { label: () => string; value: number };
		money?: { label: () => string; text: string; color: string };
	};

	/** A ratio KPI, or nothing when the server couldn't derive the ratio. */
	const ratioKpi = (label: () => string, value: number | null) =>
		value === null ? undefined : { label, value };

	// Secondary KPIs per role, table-driven like DETAIL/SLOTS below.
	const KPIS: Record<string, (c: CostToday) => CardKpis> = {
		'production.today': (c) => ({
			ratio: ratioKpi(m.energy_self_consumption, c.selfConsumption)
		}),
		'load.energy.today': (c) => ({
			ratio: ratioKpi(m.energy_autarky, c.selfSufficiency),
			// What buying the self-consumed energy would have cost instead.
			money: {
				label: m.energy_saved,
				text: `+${money(c.solarSavings, c.currency)}`,
				color: 'text-sign-good'
			}
		}),
		'grid.energy.exported.today': (c) => ({
			money: {
				label: m.energy_earned,
				text: `+${money(c.exportEarnings, c.currency)}`,
				color: 'text-sign-good'
			}
		}),
		'grid.energy.imported.today': (c) => ({
			money: {
				label: m.energy_spent,
				text: `−${money(c.importCost, c.currency)}`,
				color: 'text-sign-bad'
			}
		})
	};

	const kpisFor = (role: CanonicalRole, cost: CostToday): CardKpis => KPIS[role]?.(cost) ?? {};

	const DEFS: {
		role: CanonicalRole;
		label: () => string;
		icon: Component;
		accent: string;
		tint: string;
		bar: string;
	}[] = [
		{ role: 'production.today', label: m.energy_production, icon: Sun, accent: 'text-energy-solar', tint: 'bg-energy-solar/15', bar: 'bg-energy-solar' },
		{ role: 'load.energy.today', label: m.energy_consumption, icon: House, accent: 'text-energy-load', tint: 'bg-energy-load/15', bar: 'bg-energy-load' },
		{ role: 'grid.energy.exported.today', label: m.energy_feed_in, icon: ArrowLineUp, accent: 'text-energy-export', tint: 'bg-energy-export/15', bar: 'bg-energy-export' },
		{ role: 'grid.energy.imported.today', label: m.energy_purchase, icon: ArrowLineDown, accent: 'text-energy-grid', tint: 'bg-energy-grid/15', bar: 'bg-energy-grid' }
	];

	// Which secondary slots each role can ever fill, independent of data. Used to
	// shape the loading skeleton and to reserve matching slot heights on every
	// card so the ratio and money rows line up across the whole strip.
	type SlotShape = { ratio: boolean; money: boolean };
	const NO_SLOTS: SlotShape = { ratio: false, money: false };
	const SLOTS: Record<string, SlotShape> = {
		'production.today': { ratio: true, money: false },
		'load.energy.today': { ratio: true, money: true },
		'grid.energy.exported.today': { ratio: false, money: true },
		'grid.energy.imported.today': { ratio: false, money: true }
	};

	/** The ratio row: percentage of the card's own ratio KPI. */
	function ratioRow(kpis: CardKpis | null, slots: SlotShape) {
		const ratio = kpis?.ratio;
		if (!ratio) {
			return {
				loading: kpis === null && slots.ratio,
				label: undefined,
				value: undefined,
				valueClass: ''
			};
		}
		return { loading: false, label: ratio.label(), value: `${percent(ratio.value)}%`, valueClass: '' };
	}

	/** The money row: a signed currency figure in its own colour. */
	function moneyRow(kpis: CardKpis | null, slots: SlotShape) {
		const cash = kpis?.money;
		if (!cash) {
			return {
				loading: kpis === null && slots.money,
				label: undefined,
				value: undefined,
				valueClass: ''
			};
		}
		return { loading: false, label: cash.label(), value: cash.text, valueClass: cash.color };
	}

	/** The meter between the rows, tracking the same ratio. */
	function meterRow(ratio: CardKpis['ratio'], loading: boolean, reserved: boolean) {
		return {
			loading,
			// Only cards that can ever fill the ratio slot show a track.
			trackClass: reserved ? 'bg-border/60' : '',
			fillPercent: ratio === undefined ? undefined : percent(ratio.value)
		};
	}

	/** All three fixed secondary slots of one card. */
	function rowsFor(kpis: CardKpis | null, slots: SlotShape) {
		const ratio = ratioRow(kpis, slots);
		return {
			ratio,
			meter: meterRow(kpis?.ratio, ratio.loading, slots.ratio),
			money: moneyRow(kpis, slots)
		};
	}

	type Tile = (typeof DEFS)[number] & { metric: ManifestMetric };

	/** Everything one card renders, so its markup stays branch-free. */
	function decorate(t: Tile) {
		const slots = SLOTS[t.role] ?? NO_SLOTS;
		const kpis = cost ? kpisFor(t.role, cost) : null;
		return {
			...t,
			hasSlots: slots.ratio || slots.money,
			detail: DETAIL[t.role],
			rows: rowsFor(kpis, slots)
		};
	}

	// Only tiles whose role the active profile actually maps.
	const tiles = $derived(
		DEFS.map((d) => ({ ...d, metric: inverter.byRole(d.role) }))
			.filter((t): t is Tile => t.metric !== undefined)
			.map(decorate)
	);
</script>

{#if tiles.length > 0}
	<!-- 2×2 on every size: the cards sit in the narrow right column on lg, so a
	     fixed two-column grid reads better than letting them collapse to one wide
	     column or fan out to four skinny ones. Cards are content-sized (natural
	     height) and the grid top-aligns in its column — on tall viewports the
	     empty space falls below the cards instead of inflating them. -->
	<div class="grid grid-cols-2 gap-3 sm:gap-4">
		{#each tiles as t (t.role)}
			{@const Icon = t.icon}
			<EnergyDetailDialog
				variant={t.detail.variant}
				title={t.detail.title()}
				triggerClass={CARD_CLASS}
			>
				{#snippet trigger()}
					<span class="flex items-start justify-between gap-2">
						<span
							class="text-[0.65rem] font-medium uppercase tracking-wider text-muted-foreground sm:text-xs 2xl:text-sm"
						>
							{t.label()}
						</span>
						<span
							class="flex size-8 shrink-0 items-center justify-center rounded-lg {t.tint} 2xl:size-10"
						>
							<Icon class="size-4.5 {t.accent} 2xl:size-5" weight="duotone" />
						</span>
					</span>
					<EnergyHeadline value={inverter.value(t.metric.key)} unit={t.metric.unit} />
					<!-- Fixed slots (ratio row · meter · money row): every card reserves
					     the same heights so rows align, even when a slot is empty. -->
					{#if t.hasSlots}
						<span class="flex flex-col gap-1">
							<KpiSlotRow {...t.rows.ratio} skeletonValueWidth="w-8" />
							<KpiMeter {...t.rows.meter} barClass={t.bar} />
							<KpiSlotRow {...t.rows.money} skeletonValueWidth="w-10" />
						</span>
					{/if}
				{/snippet}
			</EnergyDetailDialog>
		{/each}
	</div>
{/if}
