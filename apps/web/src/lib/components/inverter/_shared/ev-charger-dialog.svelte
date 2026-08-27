<script lang="ts">
	// Admin variant of an EV charger tile: the whole tile is the trigger for the
	// loadpoint's quick settings (mode, charge limit, session stats).
	import * as Dialog from '$lib/components/ui/dialog';
	import * as m from '$lib/paraglide/messages';
	import EvQuickSettings from '$lib/components/inverter/ev-quick-settings.svelte';
	import EvChargerBody from './ev-charger-body.svelte';
	import type { EvccLoadpoint } from '$lib/evcc/store.svelte';

	let { lp, triggerClass }: { lp: EvccLoadpoint; triggerClass: string } = $props();

	const title = $derived(lp.title ?? m.evcc_card_title());
</script>

<Dialog.Root>
	<Dialog.Trigger class={triggerClass}>
		<EvChargerBody {lp} />
	</Dialog.Trigger>
	<Dialog.Content class="sm:max-w-md">
		<Dialog.Header>
			<Dialog.Title>{title}</Dialog.Title>
			{#if lp.vehicleTitle}
				<Dialog.Description>{lp.vehicleTitle}</Dialog.Description>
			{/if}
		</Dialog.Header>
		<EvQuickSettings {lp} />
	</Dialog.Content>
</Dialog.Root>
