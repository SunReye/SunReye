<script lang="ts">
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { SLUG_MAX } from '$lib/slug';

	/**
	 * One labelled text field with its own error line.
	 *
	 * Four of these make up the onboarding form — two names and two identifiers —
	 * and they were four copies of the same eight lines. One component instead,
	 * because the field's rules are shared and worth stating once: `maxlength` is
	 * {@link SLUG_MAX} on ALL of them, since the server refuses a name longer than
	 * the slug it becomes (`slugify` SLICES, so a longer name would be silently cut
	 * into a permanent identifier the operator never chose).
	 *
	 * `bound` vs `value` + `onValue`: a name field two-way binds to the form's own
	 * state, while an identifier field is DERIVED from the name until it is
	 * overridden, so it has to report a keystroke rather than own the value.
	 */
	let {
		id,
		label,
		error,
		bound = $bindable(),
		value,
		onValue,
		required = false
	}: {
		id: string;
		label: string;
		error?: string;
		/** Two-way, for a field that owns its value. */
		bound?: string;
		/** One-way, for a derived field. Ignored when `bound` is used. */
		value?: string;
		onValue?: (next: string) => void;
		required?: boolean;
	} = $props();
</script>

<div class="flex flex-col gap-2">
	<Label for={id}>{label}</Label>
	{#if onValue}
		<Input
			{id}
			{value}
			{required}
			maxlength={SLUG_MAX}
			autocomplete="off"
			oninput={(event) => onValue(event.currentTarget.value)}
		/>
	{:else}
		<Input {id} bind:value={bound} {required} maxlength={SLUG_MAX} autocomplete="off" />
	{/if}
	{#if error}
		<p class="text-xs text-destructive">{error}</p>
	{/if}
</div>
