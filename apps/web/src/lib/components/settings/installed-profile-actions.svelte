<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import type { RegisteredProfile } from './profile-types';
	import * as m from '$lib/paraglide/messages';

	// Row controls of the installed-profiles list. A queued profile only offers
	// the restart that applies it; the active one offers nothing; every other
	// profile can be activated and, when downloaded, removed.
	let {
		profile,
		pending,
		busyId,
		onSetActive,
		onUninstall,
		onRestart
	}: {
		profile: RegisteredProfile;
		pending: boolean;
		busyId: string | null;
		onSetActive: (p: RegisteredProfile) => void;
		onUninstall: (p: RegisteredProfile) => void;
		onRestart: () => void;
	} = $props();

	const busy = $derived(busyId === profile.id);
</script>

{#if pending}
	<Button size="sm" class="flex-1 sm:flex-none" onclick={onRestart}>
		{m.profiles_restart_short()}
	</Button>
{:else if !profile.active}
	<Button
		variant="outline"
		size="sm"
		class="flex-1 sm:flex-none"
		disabled={busy}
		onclick={() => onSetActive(profile)}
	>
		{m.profiles_set_active()}
	</Button>
	{#if profile.installed}
		<Button
			variant="ghost"
			size="sm"
			class="flex-1 sm:flex-none"
			disabled={busy}
			onclick={() => onUninstall(profile)}
		>
			{m.action_remove()}
		</Button>
	{/if}
{/if}
