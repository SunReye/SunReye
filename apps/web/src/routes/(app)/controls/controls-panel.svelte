<script lang="ts">
	import Lock from 'phosphor-svelte/lib/Lock';
	import LockOpen from 'phosphor-svelte/lib/LockOpen';
	import * as m from '$lib/paraglide/messages';
	import { Switch } from '$lib/components/ui/switch';
	import ControlRow from '$lib/components/inverter/control-row.svelte';
	import TimeOfUse from '$lib/components/inverter/time-of-use.svelte';
	import type { ManifestMetric } from '$lib/inverter/types';

	let {
		settings,
		hasTimeOfUse
	}: {
		/** Writable settings metrics, in manifest order. */
		settings: ManifestMetric[];
		hasTimeOfUse: boolean;
	} = $props();

	// Frontend guard against accidental writes: the editable region starts locked
	// and `inert` (so every control below — settings, TOU timeline/table — ignores
	// input) until the user flips this switch. Purely client-side; the backend
	// still authorizes each command on its own.
	let unlocked = $state(false);
	const locked = $derived(!unlocked);

	const LockIcon = $derived(unlocked ? LockOpen : Lock);
	const lockIconTone = $derived(unlocked ? 'text-foreground' : 'text-muted-foreground');
	const lockLabel = $derived(unlocked ? m.controls_unlocked() : m.controls_locked());

	const hasSettings = $derived(settings.length > 0);
</script>

<div class="flex items-center justify-between gap-4 border border-border p-4">
	<div class="flex items-center gap-3">
		<LockIcon class="size-5 shrink-0 {lockIconTone}" weight="duotone" />
		<div class="flex flex-col">
			<span class="text-sm font-medium">{lockLabel}</span>
			<span class="text-xs text-muted-foreground">
				{m.controls_unlock_hint()}
			</span>
		</div>
	</div>
	<Switch bind:checked={unlocked} aria-label={m.controls_unlock_aria()} />
</div>

<div
	class="flex flex-col gap-6 transition-opacity"
	class:pointer-events-none={locked}
	class:opacity-50={locked}
	inert={locked}
>
	{#if hasSettings}
		<section class="flex flex-col border border-border p-4">
			<h2 class="mb-2 text-sm font-medium uppercase tracking-wide text-muted-foreground">
				{m.controls_inverter_settings()}
			</h2>
			{#each settings as metric (metric.key)}
				<ControlRow {metric} />
			{/each}
		</section>
	{/if}

	{#if hasTimeOfUse}
		<TimeOfUse />
	{/if}
</div>
