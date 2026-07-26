<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import ActionBar from './action-bar.svelte';
	import * as m from '$lib/paraglide/messages';

	// The standard Save action for the preference forms (display, weather,
	// sensors): a primary Save plus the admin-only note, in the shared sticky
	// ActionBar. Disabled for non-admins and while the form is still loading or
	// saving.
	let {
		isAdmin,
		saving,
		disabled = false,
		onsave
	}: {
		isAdmin: boolean;
		saving: boolean;
		disabled?: boolean;
		onsave: () => void;
	} = $props();

	const blocked = $derived(!isAdmin || saving || disabled);
	const label = $derived(saving ? m.action_saving() : m.action_save());
</script>

<ActionBar>
	{#snippet info()}
		{#if !isAdmin}<span class="text-xs text-muted-foreground">{m.settings_admin_only()}</span>{/if}
	{/snippet}
	<Button onclick={onsave} disabled={blocked}>
		{label}
	</Button>
</ActionBar>
