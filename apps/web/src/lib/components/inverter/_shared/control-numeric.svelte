<script lang="ts">
	// Writable numeric setting. A manifest-declared range gets a slider (committed on
	// release); an open-ended value gets a number field with an explicit Apply, so a
	// typo never reaches the inverter on keystroke.
	import { Slider } from '$lib/components/ui/slider';
	import { Input } from '$lib/components/ui/input';
	import { Button } from '$lib/components/ui/button';
	import * as m from '$lib/paraglide/messages';

	let {
		range,
		value,
		inputValue = $bindable(''),
		busy,
		onWrite,
		onDrag
	}: {
		/** Manifest min/max; `undefined` selects the number field. */
		range: { min: number; max: number } | undefined;
		value: number;
		/** Number-field text, owned by the parent so it survives a re-seed. */
		inputValue?: string;
		busy: boolean;
		onWrite: (v: number) => void;
		/** Slider drag position, before the user releases. */
		onDrag: (v: number) => void;
	} = $props();

	// Nothing to apply while a write is in flight, the field is empty, or the typed
	// value already matches the live one.
	const applyDisabled = $derived(busy || inputValue === '' || Number(inputValue) === value);

	const apply = () => onWrite(Number(inputValue));
</script>

{#if range}
	<Slider
		type="single"
		{value}
		min={range.min}
		max={range.max}
		step={1}
		onValueChange={onDrag}
		onValueCommit={onWrite}
		disabled={busy}
	/>
{:else}
	<div class="flex items-center gap-2">
		<Input type="number" bind:value={inputValue} class="w-32" />
		<Button size="sm" variant="secondary" disabled={applyDisabled} onclick={apply}>
			{m.action_apply()}
		</Button>
	</div>
{/if}
