<script lang="ts">
	import type { Snippet } from 'svelte';
	import { Button } from '$lib/components/ui/button';
	import ActionBar from './action-bar.svelte';
	import * as m from '$lib/paraglide/messages';

	// Actions for the connection settings forms: Test + Save, an optional test
	// result line, and extra controls (e.g. a snapshot trigger). Rendered in the
	// shared sticky ActionBar so it sits at the top of the form like every other
	// settings panel.
	let {
		result = null,
		testing,
		saving,
		disabled = false,
		ontest,
		onsave,
		children
	}: {
		result?: { ok: boolean; message: string } | null;
		testing: boolean;
		saving: boolean;
		disabled?: boolean;
		ontest: () => void;
		onsave: () => void;
		children?: Snippet;
	} = $props();

	const resultClass = $derived(result?.ok ? 'text-emerald-500' : 'text-destructive');
	const testBlocked = $derived(disabled || testing);
	const testLabel = $derived(testing ? m.conn_testing() : m.conn_test());
	const saveBlocked = $derived(disabled || saving);
	const saveLabel = $derived(saving ? m.action_saving() : m.action_save());
</script>

<ActionBar>
	{#snippet info()}
		{#if result}
			<span class={resultClass}>{result.message}</span>
		{/if}
	{/snippet}
	{#if children}{@render children()}{/if}
	<Button variant="outline" onclick={ontest} disabled={testBlocked}>
		{testLabel}
	</Button>
	<Button onclick={onsave} disabled={saveBlocked}>
		{saveLabel}
	</Button>
</ActionBar>
