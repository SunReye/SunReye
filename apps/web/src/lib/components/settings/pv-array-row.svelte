<script lang="ts">
	import TrashIcon from 'phosphor-svelte/lib/Trash';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import * as m from '$lib/paraglide/messages';

	// One PV array row. Only the first row carries the column headings, so the
	// stack reads as a table; ids stay per-row so each label targets its own input.
	// The three fields stay raw text — the parent parses them on save.
	let {
		kwp = $bindable(),
		tilt = $bindable(),
		azimuth = $bindable(),
		index,
		labelled,
		disabled,
		onremove
	}: {
		kwp: string;
		tilt: string;
		azimuth: string;
		index: number;
		/** Render the column headings (first row only). */
		labelled: boolean;
		disabled: boolean;
		onremove: () => void;
	} = $props();
</script>

<div class="grid grid-cols-[1fr_1fr_1fr_auto] items-end gap-2">
	<div class="flex flex-col gap-1.5">
		{#if labelled}<Label for={`array-kwp-${index}`}>{m.weather_forecast_kwp()}</Label>{/if}
		<Input
			id={`array-kwp-${index}`}
			bind:value={kwp}
			{disabled}
			inputmode="decimal"
			placeholder="9.6"
		/>
	</div>
	<div class="flex flex-col gap-1.5">
		{#if labelled}<Label for={`array-tilt-${index}`}>{m.weather_forecast_tilt()}</Label>{/if}
		<Input
			id={`array-tilt-${index}`}
			bind:value={tilt}
			{disabled}
			inputmode="decimal"
			placeholder="30"
		/>
	</div>
	<div class="flex flex-col gap-1.5">
		{#if labelled}<Label for={`array-azimuth-${index}`}>{m.weather_forecast_azimuth()}</Label>{/if}
		<Input
			id={`array-azimuth-${index}`}
			bind:value={azimuth}
			{disabled}
			inputmode="decimal"
			placeholder="0"
		/>
	</div>
	<Button
		variant="ghost"
		size="icon"
		onclick={onremove}
		{disabled}
		aria-label={m.weather_forecast_remove()}
	>
		<TrashIcon class="size-4" />
	</Button>
</div>
