<script lang="ts">
	// The palette chooser: one row for the plant (admin-only), one for this
	// browser.
	//
	// Two rows because they answer different questions. The plant setting is
	// what a wall display and every other viewer shows; the device override is
	// one pair of eyes, kept in this browser and sent nowhere — which is how a
	// reader who cannot separate the plant's palette helps themselves without
	// being an admin and without changing what anyone else sees.
	import { Label } from '$lib/components/ui/label';
	import * as m from '$lib/paraglide/messages';
	import PaletteSelect from '$lib/components/settings/palette-select.svelte';
	import { chartPalette } from '$lib/chart-palette.svelte';
	import type { PalettePreset } from '$lib/inverter/palette-preset';

	let { canEdit = false }: { canEdit?: boolean } = $props();

	const LABELS: Record<PalettePreset, () => string> = {
		categorical: m.palette_categorical,
		colorblind: m.palette_colorblind,
		vivid: m.palette_vivid,
		muted: m.palette_muted
	};
	const labelFor = (preset: PalettePreset) => LABELS[preset]();

	/** Sentinel for "no override" — `null` is not a Select value. */
	const FOLLOW = 'follow';

	const deviceValue = $derived(chartPalette.override ?? FOLLOW);
	const deviceLabel = $derived(
		chartPalette.override ? labelFor(chartPalette.override) : m.palette_follow_instance()
	);

	const pickInstance = (value: string) => void chartPalette.save(value as PalettePreset);
	const pickDevice = (value: string) =>
		chartPalette.setOverride(value === FOLLOW ? null : (value as PalettePreset));
</script>

<div class="flex flex-col gap-4">
	{#if canEdit}
		<div class="flex flex-col gap-2">
			<Label for="palette-instance">{m.palette_instance()}</Label>
			<PaletteSelect
				id="palette-instance"
				value={chartPalette.instance}
				label={labelFor(chartPalette.instance)}
				follow={null}
				{labelFor}
				onPick={pickInstance}
			/>
		</div>
	{/if}

	<div class="flex flex-col gap-2">
		<Label for="palette-device">{m.palette_device()}</Label>
		<PaletteSelect
			id="palette-device"
			value={deviceValue}
			label={deviceLabel}
			follow={{ value: FOLLOW, label: m.palette_follow_instance() }}
			{labelFor}
			onPick={pickDevice}
		/>
		<p class="text-xs text-muted-foreground">{m.palette_device_hint()}</p>
	</div>
</div>
