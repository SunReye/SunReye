<script lang="ts">
	import type { Snippet } from 'svelte';
	import { inverter } from '$lib/inverter/store.svelte';
	import { formatValue } from '$lib/inverter/format';
	import type { CanonicalRole, ManifestMetric } from '$lib/inverter/types';
	import Kpi from '$lib/components/inverter/kpi.svelte';
	import BatteryBar from '$lib/components/inverter/battery-bar.svelte';
	import SubsystemSection from '$lib/components/inverter/subsystem-section.svelte';
	import IndexedGroup from '$lib/components/inverter/indexed-group.svelte';
	import { setPageHeader } from '$lib/page-header.svelte';
	import PageShell from '$lib/components/layout/page-shell.svelte';
	import * as m from '$lib/paraglide/messages';

	$effect(() => setPageHeader(m.nav_system()));

	const caps = $derived(inverter.capabilities);

	// Canonical-role KPIs get a translated label from the role (not the profile's
	// author-chosen label), falling back to the profile label if unmapped.
	const KPI_DEFS: { role: CanonicalRole; label: () => string; accent: string; diverging?: boolean }[] =
		[
			{ role: 'pv.total.power', label: m.label_solar, accent: 'var(--chart-1)' },
			{ role: 'battery.power', label: m.label_battery, accent: 'var(--chart-3)' },
			{ role: 'grid.power', label: m.label_grid, accent: 'var(--chart-4)', diverging: true },
			{ role: 'load.power', label: m.label_load, accent: 'var(--chart-5)' }
		];

	const kpis = $derived(
		KPI_DEFS.map((d) => ({ ...d, metric: inverter.byRole(d.role) })).filter(
			(k): k is typeof k & { metric: ManifestMetric } => k.metric !== undefined
		)
	);

	// Resolve each KPI's live reading up front so the markup stays a plain list.
	const kpiCards = $derived(
		kpis.map((k) => {
			const value = inverter.value(k.metric.key);
			return {
				role: k.role,
				label: k.label(),
				value,
				text: formatValue(k.metric, value),
				unit: k.metric.unit ?? '',
				points: inverter.series(k.metric.key),
				accent: k.accent,
				diverging: k.diverging ?? false
			};
		})
	);

	const socMetric = $derived(inverter.byRole('battery.soc'));
	const batteryPowerMetric = $derived(inverter.byRole('battery.power'));
	const socValue = $derived(socMetric ? inverter.value(socMetric.key) : undefined);
	const batteryPowerValue = $derived(
		batteryPowerMetric ? inverter.value(batteryPowerMetric.key) : undefined
	);
	const batteryRows = $derived(
		inverter.inGroup('battery').filter((m) => m.role !== 'battery.soc' && m.role !== 'battery.power')
	);

	const inverterStatus = $derived(
		(
			[
				'inverter.status',
				'inverter.relay_status',
				'inverter.temperature.dc',
				'inverter.temperature.ac'
			] as CanonicalRole[]
		)
			.map((r) => inverter.byRole(r))
			.filter((m): m is ManifestMetric => m !== undefined)
	);

	const pvStrings = $derived(Array.from({ length: caps?.pvStrings ?? 0 }, (_, i) => i + 1));
	const phases = $derived(Array.from({ length: caps?.phases ?? 0 }, (_, i) => i + 1));

	const stringRoles: CanonicalRole[] = ['pv.string.power', 'pv.string.voltage', 'pv.string.current'];
	const phaseRoles: CanonicalRole[] = ['grid.phase.voltage', 'grid.phase.current', 'grid.phase.power'];

	// Capabilities are server-derived and stay true even when a subsystem's
	// metrics are hidden from the dashboard (Settings → Sensors). Gate each
	// section on whether it still has *visible* metrics so hiding a group (e.g. an
	// unconnected generator) drops its section instead of leaving an empty header.
	const generatorMetrics = $derived(inverter.inGroup('generator'));
	const backupMetrics = $derived(inverter.inGroup('load'));
	const hasBatteryContent = $derived(
		batteryRows.length > 0 || socMetric !== undefined || batteryPowerMetric !== undefined
	);
	const hasStringMetrics = $derived(
		inverter.metrics.some((mtr) => mtr.role !== undefined && stringRoles.includes(mtr.role))
	);
	const hasPhaseMetrics = $derived(
		inverter.metrics.some((mtr) => mtr.role !== undefined && phaseRoles.includes(mtr.role))
	);

	const showBattery = $derived(Boolean(caps?.battery) && hasBatteryContent);
	const showStrings = $derived(pvStrings.length > 0 && hasStringMetrics);
	const showPhases = $derived(Boolean(caps?.grid) && phases.length > 0 && hasPhaseMetrics);
	const showGenerator = $derived(Boolean(caps?.generator) && generatorMetrics.length > 0);
	const showBackup = $derived(Boolean(caps?.backupLoad) && backupMetrics.length > 0);

	/** One subsystem panel: its metric rows plus an optional custom body above them. */
	type Section = {
		id: string;
		show: boolean;
		title: string;
		metrics: ManifestMetric[];
		body?: Snippet;
	};

	// The panel grid, in display order — each entry carries its own visibility gate
	// so the markup is a single list rather than a stack of conditionals.
	const sections: Section[] = $derived([
		{
			id: 'battery',
			show: showBattery,
			title: m.label_battery(),
			metrics: batteryRows,
			body: batteryBody
		},
		{
			id: 'inverter',
			show: inverterStatus.length > 0,
			title: m.label_inverter(),
			metrics: inverterStatus
		},
		{
			id: 'strings',
			show: showStrings,
			title: m.system_solar_strings({ count: pvStrings.length }),
			metrics: [],
			body: stringsBody
		},
		{
			id: 'phases',
			show: showPhases,
			title: m.system_grid_phase({ count: phases.length }),
			metrics: [],
			body: phasesBody
		},
		{
			id: 'generator',
			show: showGenerator,
			title: m.label_generator(),
			metrics: generatorMetrics
		},
		{
			id: 'backup',
			show: showBackup,
			title: m.system_backup_load(),
			metrics: backupMetrics
		}
	]);
	const visibleSections = $derived(sections.filter((s) => s.show));
</script>

{#snippet batteryBody()}
	<BatteryBar soc={socValue} power={batteryPowerValue} />
{/snippet}

{#snippet stringsBody()}
	<IndexedGroup label={m.label_string()} indices={pvStrings} roles={stringRoles} />
{/snippet}

{#snippet phasesBody()}
	<IndexedGroup
		label={m.label_phase()}
		indices={phases}
		roles={phaseRoles}
		columns="sm:grid-cols-2 lg:grid-cols-3"
	/>
{/snippet}

<!-- Was `gap-8` — a sixth rhythm nobody chose. The shell's gap is the rhythm. -->
<PageShell width="wide">
	<section class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-2">
		{#each kpiCards as k (k.role)}
			<div class="min-w-0 border border-border">
				<Kpi
					label={k.label}
					value={k.value}
					text={k.text}
					unit={k.unit}
					points={k.points}
					accent={k.accent}
					diverging={k.diverging}
				/>
			</div>
		{/each}
	</section>

	<div class="grid grid-cols-1 gap-6 lg:grid-cols-2">
		{#each visibleSections as s (s.id)}
			<SubsystemSection title={s.title} metrics={s.metrics} children={s.body} />
		{/each}
	</div>
</PageShell>
