<script lang="ts">
	// One palette dropdown. Two of these make the picker — the plant's and this
	// device's — and writing the list twice put the picker's template over the
	// complexity gate, which is the gate doing its job: the two differ only by
	// whether they offer "follow the plant".
	//
	// Each option previews itself in the colours it selects, so the choice is
	// made by looking rather than by reading four adjectives.
	import * as Select from '$lib/components/ui/select';
	import { PALETTE_PRESETS, type PalettePreset } from '$lib/inverter/palette-preset';

	let {
		id,
		value,
		label,
		follow,
		labelFor,
		onPick
	}: {
		id: string;
		/** The selected preset, or {@link follow} when this select offers it. */
		value: string;
		/** What the trigger reads. */
		label: string;
		/** Value + text of the "follow the plant" row, or null to omit it. */
		follow: { value: string; label: string } | null;
		labelFor: (preset: PalettePreset) => string;
		onPick: (value: string) => void;
	} = $props();

	/** The meanings a reader actually has to tell apart, in preview order. */
	const SWATCHES = ['energy-solar', 'energy-grid', 'energy-battery', 'energy-load', 'energy-ev'];

	// The shipped palette stamps no attribute — it IS `:root` — so a row for it
	// previews in the base tokens. Resolved here rather than inline so the
	// snippet stays one expression per line.
	const scopeOf = (preset: PalettePreset) => (preset === 'categorical' ? undefined : preset);
</script>

<!-- Rendered inside the preset's own `data-palette` scope, so each row shows
     THAT preset's colours rather than the one currently active. -->
{#snippet swatches(preset: PalettePreset)}
	<span
		class="flex items-center gap-1"
		data-palette={scopeOf(preset)}
	>
		{#each SWATCHES as token (token)}
			<span class="size-2.5 rounded-full" style="background: var(--{token})"></span>
		{/each}
	</span>
{/snippet}

<Select.Root type="single" {value} onValueChange={onPick}>
	<Select.Trigger {id} class="w-full sm:w-72">{label}</Select.Trigger>
	<Select.Content>
		{#if follow}
			<Select.Item value={follow.value} label={follow.label}>{follow.label}</Select.Item>
		{/if}
		{#each PALETTE_PRESETS as preset (preset)}
			<Select.Item value={preset} label={labelFor(preset)}>
				<span class="flex w-full items-center justify-between gap-3">
					<span>{labelFor(preset)}</span>
					{@render swatches(preset)}
				</span>
			</Select.Item>
		{/each}
	</Select.Content>
</Select.Root>
