<script lang="ts">
	import { resolve } from '$lib/resolve';
	import Coins from 'phosphor-svelte/lib/Coins';
	import * as m from '$lib/paraglide/messages';
	import { Button } from '$lib/components/ui/button';
	import EmptyState from '$lib/components/layout/empty-state.svelte';
	import { useAppSession } from '$lib/session';

	// The amortisation section before a price is entered: say what is missing,
	// and offer the way to the field — to the people who can edit it.
	const session = useAppSession();
	const isAdmin = $derived($session.data?.user.role === 'admin');
</script>

<EmptyState message={m.amortisation_empty()} icon={Coins}>
	{#snippet action()}
		{#if isAdmin}
			<Button variant="outline" size="sm" href={resolve('/settings/tariff')}>
				{m.amortisation_empty_action()}
			</Button>
		{/if}
	{/snippet}
</EmptyState>
