<script lang="ts">
	import { evcc } from '$lib/evcc/store.svelte';
	import { useAppSession } from '$lib/session';
	import EvChargerBody from './_shared/ev-charger-body.svelte';
	import EvChargerDialog from './_shared/ev-charger-dialog.svelte';

	// Same tile surface as the daily-energy cards so the strip reads as one row.
	const CARD_CLASS =
		'flex w-full flex-col gap-2 rounded-xl border border-border/60 bg-card p-3 text-left sm:p-4';
	const TRIGGER_CLASS = `${CARD_CLASS} transition-colors hover:border-border hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring`;

	const session = useAppSession();
	// Commands are admin-only server-side; everyone else gets the read-only tile.
	const isAdmin = $derived($session.data?.user.role === 'admin');

	$effect(() => evcc.connect());
</script>

{#if evcc.active}
	<div class="flex flex-col gap-3 sm:gap-4">
		{#each evcc.loadpoints as lp (lp.index)}
			{#if isAdmin}
				<EvChargerDialog {lp} triggerClass={TRIGGER_CLASS} />
			{:else}
				<div class={CARD_CLASS}>
					<EvChargerBody {lp} />
				</div>
			{/if}
		{/each}
	</div>
{/if}
