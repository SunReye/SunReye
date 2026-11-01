<script lang="ts">
	import { toast } from 'svelte-sonner';
	import { coreCapabilities } from '$lib/capabilities.svelte';
	import { Button } from '$lib/components/ui/button';
	import { restartServer } from '$lib/engine-admin';
	import * as m from '$lib/paraglide/messages';

	// Triggers a supervised server restart and waits for it to come back (then the
	// page reloads). Shared by the onboarding activate step and the settings
	// "restart required" banner.
	let {
		label = m.settings_restart_server(),
		variant = 'default',
		size = 'default'
	}: {
		label?: string;
		variant?: 'default' | 'outline' | 'ghost';
		size?: 'default' | 'sm';
	} = $props();

	let restarting = $state(false);

	async function restart() {
		restarting = true;
		const ok = await restartServer();
		// On success the page reloads, so we only reach here on failure.
		restarting = false;
		if (!ok) toast.error(m.settings_restart_failed());
	}
</script>

{#if coreCapabilities.has('restart')}
	<Button {variant} {size} disabled={restarting} onclick={restart}>
		{restarting ? m.settings_restart_restarting() : label}
	</Button>
{/if}
