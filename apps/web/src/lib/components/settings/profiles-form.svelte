<script lang="ts">
	import { onMount } from "svelte";
	import { toast } from "svelte-sonner";
	import { api } from "$lib/api";
	import { Button } from "$lib/components/ui/button";
	import * as Dialog from "$lib/components/ui/dialog";
	import ExternalProfilesManager from "./external-profiles-manager.svelte";
	import InstalledProfilesList from "./installed-profiles-list.svelte";
	import ProfileUpdatesBanner from "./profile-updates-banner.svelte";
	import RestartButton from "./restart-button.svelte";
	import type { ProfileUpdate, RegisteredProfile } from "./profile-types";
	import * as m from "$lib/paraglide/messages";

	let registered = $state<RegisteredProfile[]>([]);
	let updates = $state<ProfileUpdate[]>([]);
	let restartRequired = $state(false);
	let busyId = $state<string | null>(null);
	let restartOpen = $state(false);

	async function loadRegistered() {
		const { data } = await api.api.profiles.get();
		if (data) registered = data as RegisteredProfile[];
	}

	async function loadUpdates() {
		// Cached result of the server's background update checker (semver-aware).
		const { data } = await api.api.profiles.updates.get();
		if (data) updates = data.updates as ProfileUpdate[];
	}

	onMount(() => {
		void loadRegistered();
		void loadUpdates();
	});

	async function onExternalInstalled() {
		// The server registers a downloaded profile immediately, so it shows in the
		// installed list right away — no restart needed just to download. Binding
		// it to a device happens in Settings → Devices.
		await Promise.all([loadRegistered(), loadUpdates()]);
	}

	async function updateProfile(u: ProfileUpdate) {
		busyId = u.id;
		const { error } = await api.api.profiles.install.post({ source: u.source, id: u.id });
		busyId = null;
		if (error) {
			toast.error(m.profiles_toast_update_failed({ error: String(error.value) }));
			return;
		}
		toast.success(m.profiles_toast_updated({ name: u.name, version: u.latestVersion }));
		restartRequired = true;
		updates = updates.filter((x) => x.id !== u.id);
		await loadRegistered();
	}

	async function uninstall(p: RegisteredProfile) {
		busyId = p.id;
		const { error } = await api.api.profiles({ id: p.id }).delete();
		busyId = null;
		if (error) {
			toast.error(m.profiles_toast_uninstall_failed({ error: String(error.value) }));
			return;
		}
		toast.success(m.profiles_toast_uninstalled({ name: p.name }));
		await loadRegistered();
	}
</script>

<div class="flex flex-col gap-6">
	<ProfileUpdatesBanner {updates} {busyId} onUpdate={updateProfile} />

	{#if restartRequired}
		<div
			class="flex flex-col gap-3 border border-amber-500/50 bg-amber-500/10 p-3 text-sm text-amber-700 sm:flex-row sm:items-center sm:gap-2 dark:text-amber-400"
		>
			<span class="flex items-center gap-2">
				<span class="inline-block size-2 shrink-0 rounded-full bg-amber-500"></span>
				<span>{m.profiles_restart_required()}</span>
			</span>
			<div class="sm:ml-auto">
				<Button
					size="sm"
					variant="outline"
					class="w-full sm:w-auto"
					onclick={() => (restartOpen = true)}
				>
					{m.settings_restart_now()}
				</Button>
			</div>
		</div>
	{/if}

	<InstalledProfilesList
		profiles={registered}
		{busyId}
		onUninstall={uninstall}
	/>

	<ExternalProfilesManager onInstalled={onExternalInstalled} />
</div>

<Dialog.Root bind:open={restartOpen}>
	<Dialog.Content>
		<Dialog.Header>
			<Dialog.Title>{m.profiles_restart_dialog_title()}</Dialog.Title>
			<Dialog.Description>{m.profiles_restart_generic()}</Dialog.Description>
		</Dialog.Header>
		<Dialog.Footer>
			<Button variant="outline" onclick={() => (restartOpen = false)}>{m.action_cancel()}</Button>
			<RestartButton label={m.settings_restart_now()} />
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
