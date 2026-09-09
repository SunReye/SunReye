<script lang="ts">
	import * as m from '$lib/paraglide/messages';
	import type { RegisteredProfile } from './profile-types';
	import RowRemoveButton from './row-remove-button.svelte';

	// Row control of the installed-profiles list: a downloaded profile no device
	// uses can be deleted. One a device uses offers nothing — it is bound and
	// unbound in Settings → Devices, and the server refuses the delete (409). A
	// built-in ships with the server and has nothing to delete.
	let {
		profile,
		busyId,
		onUninstall
	}: {
		profile: RegisteredProfile;
		busyId: string | null;
		onUninstall: (p: RegisteredProfile) => void;
	} = $props();

	const removable = $derived(!profile.active && profile.installed);
</script>

{#if removable}
	<RowRemoveButton
		label={m.profiles_remove_aria({ name: profile.name })}
		disabled={busyId === profile.id}
		onclick={() => onUninstall(profile)}
	/>
{/if}
