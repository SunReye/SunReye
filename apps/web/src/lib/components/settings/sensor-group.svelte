<script lang="ts">
	import { Label } from '$lib/components/ui/label';
	import { Switch } from '$lib/components/ui/switch';
	import type { ManifestMetric } from '$lib/inverter/types';
	import * as m from '$lib/paraglide/messages';

	// One subsystem group of the sensor catalog: a sticky header carrying the
	// group switch and the visible/total count, then a switch per metric. Hiding
	// the whole group replaces the per-metric list with a note.
	let {
		label,
		metrics,
		visible,
		disabled,
		isMetricVisible,
		onGroupChange,
		onMetricChange
	}: {
		label: string;
		metrics: ManifestMetric[];
		visible: boolean;
		disabled: boolean;
		isMetricVisible: (metric: ManifestMetric) => boolean;
		onGroupChange: (visible: boolean) => void;
		onMetricChange: (key: string, visible: boolean) => void;
	} = $props();

	const countLabel = $derived(
		m.settings_sensors_count({
			visible: metrics.filter(isMetricVisible).length,
			total: metrics.length
		})
	);
</script>

<div class="border-b border-border last:border-b-0">
	<div
		class="sticky top-0 z-10 flex items-center justify-between gap-4 border-b border-border bg-background/95 px-3 py-2 backdrop-blur supports-backdrop-filter:bg-background/80"
	>
		<div class="flex flex-col gap-0.5">
			<span class="text-sm font-medium">{label}</span>
			<span class="text-xs text-muted-foreground tabular-nums">
				{countLabel}
			</span>
		</div>
		<Switch checked={visible} {disabled} aria-label={label} onCheckedChange={onGroupChange} />
	</div>

	{#if visible}
		<div class="divide-y divide-border">
			{#each metrics as metric (metric.key)}
				<div class="flex items-center justify-between gap-4 px-3 py-2">
					<div class="flex min-w-0 flex-col">
						<Label for="sensor-{metric.key}" class="truncate">{metric.label}</Label>
						<span class="truncate font-mono text-xs text-muted-foreground">{metric.key}</span>
					</div>
					<Switch
						id="sensor-{metric.key}"
						size="sm"
						checked={isMetricVisible(metric)}
						{disabled}
						onCheckedChange={(v) => onMetricChange(metric.key, v)}
					/>
				</div>
			{/each}
		</div>
	{:else}
		<p class="px-3 py-2 text-xs text-muted-foreground">{m.settings_sensors_group_hidden()}</p>
	{/if}
</div>
