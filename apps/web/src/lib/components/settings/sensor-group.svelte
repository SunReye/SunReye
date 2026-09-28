<script lang="ts">
	import { Label } from '$lib/components/ui/label';
	import { Switch } from '$lib/components/ui/switch';
	import type { ManifestMetric } from '$lib/inverter/types';
	import * as m from '$lib/paraglide/messages';

	// One subsystem group of the sensor catalog: a sticky header carrying the
	// group switch and the visible/total count, then a switch per metric. Hiding
	// the whole group replaces the per-metric list with a note.
	//
	// Sticky against ITS OWN scrollport, not the shell's. The catalog renders
	// inside `max-h-[60svh] overflow-y-auto` (sensors-form.svelte) — a real
	// scroll container — so `top-0` here means the top edge of that box and has
	// nothing to do with the shell's `--sticky-top`. It must NOT adopt that
	// offset: the box is a few hundred pixels down the panel, and pushing the
	// header to the header's y would park it outside its own scrollport.
	//
	// This is the trap the shell's sticky rework walked into once already: the
	// page-level chrome and a scrolling box inside a card answer to different
	// scrollports, and `--sticky-top` is only the page one. `z-10` competes only
	// with siblings inside this box, which is why it does not need a rung on the
	// shell ladder in `(app)/+layout.svelte`.
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
		data-slot="sensor-group-header"
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
