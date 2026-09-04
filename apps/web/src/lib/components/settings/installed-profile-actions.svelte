<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import type { RegisteredProfile } from './profile-types';
	import * as m from '$lib/paraglide/messages';

	// Row controls of the installed-profiles list. A profile a device uses
	// offers nothing here — it is bound and unbound in Settings → Devices, and the
	// server refuses to uninstall it (409). Every other downloaded profile can be
	// removed; a built-in one has nothing to remove.
	let {
		profile,
		busyId,
		onUninstall
	}: {
		profile: RegisteredProfile;
		busyId: string | null;
		onUninstall: (p: RegisteredProfile) => void;
	} = $props();

	const busy = $derived(busyId === profile.id);
</script>

{#if !profile.active && profile.installed}
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
