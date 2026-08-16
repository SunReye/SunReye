<script lang="ts">
	import { inverter } from '$lib/inverter/store.svelte';
	import type { CanonicalRole, ManifestMetric } from '$lib/inverter/types';
	import StatRow from './stat-row.svelte';

	let {
		label,
		indices,
		roles,
		columns = 'sm:grid-cols-2'
	}: {
		label: string;
		indices: number[];
		roles: CanonicalRole[];
		columns?: string;
	} = $props();

	function metrics(i: number): ManifestMetric[] {
		return roles.map((r) => inverter.byRole(r, i)).filter((m): m is ManifestMetric => m !== undefined);
	}
</script>

<div class={`grid grid-cols-1 gap-4 ${columns}`}>
	{#each indices as i (i)}
		<div class="flex flex-col gap-1">
			<span class="text-xs font-medium">{label} {i}</span>
			{#each metrics(i) as m (m.key)}
				<StatRow metric={m} value={inverter.value(m.key)} />
			{/each}
		</div>
	{/each}
</div>
