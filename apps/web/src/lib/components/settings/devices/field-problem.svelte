<script lang="ts">
	// The one-line message under a field: the server's refusal when it named
	// this field, else the client-side hint, else nothing. One component so the
	// precedence is decided once rather than in every field.
	import type { Refusal, RefusedField } from './add-device-logic';

	let {
		field,
		refusal,
		hint = null,
		hintIsProblem = true
	}: {
		field: RefusedField;
		refusal: Refusal | null;
		/** What to say when the server has not refused this field. */
		hint?: string | null;
		/** Whether the hint is a problem (destructive colour) or plain guidance. */
		hintIsProblem?: boolean;
	} = $props();

	const refused = $derived(refusal?.field === field ? refusal.message : null);
</script>

{#if refused}
	<p class="text-xs text-destructive">{refused}</p>
{:else if hint}
	<p class="text-xs {hintIsProblem ? 'text-destructive' : 'font-mono text-muted-foreground'}">
		{hint}
	</p>
{/if}
