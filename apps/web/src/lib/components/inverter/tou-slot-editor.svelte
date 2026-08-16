<script lang="ts">
	import { Switch } from '$lib/components/ui/switch';
	import { Input } from '$lib/components/ui/input';
	import { Slider } from '$lib/components/ui/slider';
	import TouField from './_shared/tou-field.svelte';
	import * as msg from '$lib/paraglide/messages';
	import { hhmmToLabel, labelToHhmm, type TouController, type TouSlot } from '$lib/inverter/tou.svelte';
	import type { ManifestMetric } from '$lib/inverter/types';

	// Rendered keyed by slot index, so its local SOC draft resets on slot change.
	let {
		controller,
		slot,
		range,
		slotCount
	}: { controller: TouController; slot: TouSlot; range: string | null; slotCount: number } = $props();

	// Battery mode decides which target the inverter honors — show only that one.
	const mode = $derived(controller.targetMode);
	const socMetric = $derived(mode === 'voltage' ? undefined : slot.metrics.soc);
	const voltageMetric = $derived(mode === 'soc' ? undefined : slot.metrics.voltage);

	// SOC streams in as the thumb drags; commit the write only on release.
	let socDraft = $state<number | null>(null);
	const socValue = $derived(
		socDraft ?? (slot.metrics.soc ? controller.value(slot.metrics.soc.key) : undefined) ?? 0
	);

	const rangeLabel = $derived(
		range ?? msg.tou_period_of({ index: slot.index, count: slotCount })
	);

	/** Number-input value; blank rather than 0 while the register is unread. */
	const numValue = (m: ManifestMetric) => controller.value(m.key) ?? '';
	const isOn = (m: ManifestMetric) => controller.value(m.key) === 1;
	const hintFor = (on: boolean) => (on ? msg.tou_charges_hint() : msg.tou_discharges_hint());

	const setEnabled = (m: ManifestMetric, checked: boolean) =>
		controller.write(m.key, checked ? 1 : 0, m.label);

	function commitNumber(field: 'power' | 'voltage', raw: string) {
		const m = slot.metrics[field];
		const v = Number(raw);
		if (m && raw !== '' && !Number.isNaN(v)) controller.write(m.key, v, m.label);
	}
	function commitTime(raw: string) {
		const m = slot.metrics.time;
		const v = labelToHhmm(raw);
		if (m && v !== null) controller.write(m.key, v, m.label);
	}
</script>

<div class="flex flex-col gap-4 rounded-lg border border-border bg-muted/30 p-4">
	<div class="flex items-center justify-between">
		<h3 class="text-sm font-semibold">{msg.tou_slot_n({ index: slot.index })}</h3>
		<span class="text-xs tabular-nums text-muted-foreground">{rangeLabel}</span>
	</div>

	<div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
		<TouField
			metric={slot.metrics.time}
			label={msg.tou_start_time()}
			labelFor="tou-start-{slot.index}"
		>
			{#snippet children(m)}
				<Input
					id="tou-start-{slot.index}"
					type="time"
					value={hhmmToLabel(controller.value(m.key))}
					disabled={controller.busy(m.key)}
					onchange={(e) => commitTime(e.currentTarget.value)}
				/>
			{/snippet}
		</TouField>

		<TouField metric={slot.metrics.enabled} label={msg.tou_grid_charge()}>
			{#snippet children(m)}
				<div class="flex h-8 items-center gap-2">
					<Switch
						checked={isOn(m)}
						onCheckedChange={(c) => setEnabled(m, c)}
						disabled={controller.busy(m.key)}
					/>
					<span class="text-xs text-muted-foreground">{hintFor(isOn(m))}</span>
				</div>
			{/snippet}
		</TouField>

		<TouField
			metric={socMetric}
			label={msg.tou_target_soc_label()}
			class="sm:col-span-2"
		>
			{#snippet aside()}
				<span class="text-xs font-medium tabular-nums">{socValue}%</span>
			{/snippet}
			{#snippet children(m)}
				<Slider
					type="single"
					value={socValue}
					min={0}
					max={100}
					step={1}
					disabled={controller.busy(m.key)}
					onValueChange={(v) => (socDraft = v)}
					onValueCommit={(v) => controller.write(m.key, v, m.label)}
				/>
			{/snippet}
		</TouField>

		<TouField
			metric={slot.metrics.power}
			label={msg.tou_max_power()}
			labelFor="tou-power-{slot.index}"
		>
			{#snippet children(m)}
				<Input
					id="tou-power-{slot.index}"
					type="number"
					value={numValue(m)}
					disabled={controller.busy(m.key)}
					onchange={(e) => commitNumber('power', e.currentTarget.value)}
				/>
			{/snippet}
		</TouField>

		<TouField
			metric={voltageMetric}
			label={msg.tou_target_voltage()}
			labelFor="tou-voltage-{slot.index}"
		>
			{#snippet children(m)}
				<Input
					id="tou-voltage-{slot.index}"
					type="number"
					step="0.01"
					value={numValue(m)}
					disabled={controller.busy(m.key)}
					onchange={(e) => commitNumber('voltage', e.currentTarget.value)}
				/>
			{/snippet}
		</TouField>
	</div>
</div>
