<script lang="ts">
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';

	/** One labelled numeric knob; `key` indexes into the text-valued draft. */
	export type NumericField = { key: string; label: string; desc: string; placeholder: string };

	// Values ride as text so a half-typed entry doesn't coerce to 0 — the parent
	// parses them on save.
	let {
		idPrefix,
		fields,
		values = $bindable(),
		readOnly
	}: {
		idPrefix: string;
		fields: NumericField[];
		values: Record<string, string>;
		readOnly: boolean;
	} = $props();
</script>

<!-- Two-up on a phone as well: these are short numeric knobs (a wattage, a
     percentage), not prose fields, so a column of 17 of them ran ~1700px on a
     412px screen — the form was taller than three viewports for values that fit
     in six characters. `min-w-0` because the descriptions under them do wrap. -->
<div class="grid grid-cols-2 gap-3 [&>*]:min-w-0">
	{#each fields as field (field.key)}
		<div class="flex flex-col gap-1.5">
			<Label for="{idPrefix}-{field.key}">{field.label}</Label>
			<Input
				id="{idPrefix}-{field.key}"
				bind:value={values[field.key]}
				disabled={readOnly}
				inputmode="decimal"
				placeholder={field.placeholder}
			/>
			<p class="text-xs text-muted-foreground">{field.desc}</p>
		</div>
	{/each}
</div>
