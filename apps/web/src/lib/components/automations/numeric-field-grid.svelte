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

<div class="grid gap-3 sm:grid-cols-2">
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
