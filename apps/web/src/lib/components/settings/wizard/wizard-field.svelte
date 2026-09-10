<script lang="ts">
	import { Label } from '$lib/components/ui/label';
	import type { CatalogField } from './add-wizard';
	import FieldBoolean from './field-boolean.svelte';
	import FieldEnum from './field-enum.svelte';
	import FieldNumber from './field-number.svelte';
	import FieldText from './field-text.svelte';

	// ONE field of an entry's settings step, rendered from the SERVER's own
	// description of it — so a new integration is a server change and no edit
	// here, which is the whole point of the catalog.
	//
	// The type picks a component out of a table rather than branching: a branch
	// per type put every input in one template, and the template was the most
	// complex thing in the wizard. A type with no entry in the table is REPORTED,
	// never skipped — silently rendering nothing would ship a settings step that
	// cannot be filled in, and the operator would have no way to know why.
	let {
		field,
		value = $bindable(),
		label
	}: {
		field: CatalogField;
		value: unknown;
		/** The translated label, or the field's own name when there is none. */
		label: string;
	} = $props();

	const BY_TYPE = {
		string: FieldText,
		number: FieldNumber,
		boolean: FieldBoolean,
		enum: FieldEnum
	};

	const id = $derived(`wizard-${field.name}`);
	const Control = $derived(BY_TYPE[field.type as keyof typeof BY_TYPE]);
</script>

<div class="flex flex-col gap-1.5">
	<Label for={id}>{label}</Label>
	{#if Control}
		<Control {field} {id} bind:value />
	{:else}
		<p class="text-xs text-destructive">{field.name}: {field.type}</p>
	{/if}
</div>
