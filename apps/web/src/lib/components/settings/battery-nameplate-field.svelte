<script lang="ts">
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import * as m from '$lib/paraglide/messages';

	// The one field of the battery record, and the only place that decides what
	// the reader is told about it: the hint when the value is usable, the
	// correction when it is not.
	let {
		value = $bindable(),
		invalid,
		disabled
	}: {
		value: string;
		invalid: boolean;
		disabled: boolean;
	} = $props();
</script>

<div class="flex flex-col gap-1.5">
	<Label for="battery-nameplate">{m.battery_nameplate()}</Label>
	<Input
		id="battery-nameplate"
		type="number"
		inputmode="decimal"
		step="0.1"
		placeholder={m.battery_nameplate_placeholder()}
		{disabled}
		bind:value
	/>
	<p class="text-xs text-muted-foreground">
		{invalid ? m.battery_nameplate_invalid() : m.battery_nameplate_hint()}
	</p>
</div>
