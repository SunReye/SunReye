<script lang="ts">
	import { onMount } from "svelte";
	import { toast } from "svelte-sonner";
	import { apiErrorText } from '$lib/api-error';
	import { coreCapabilities } from '$lib/capabilities.svelte';
	import { Button } from "$lib/components/ui/button";
	import * as Dialog from "$lib/components/ui/dialog";
	import { core } from '$lib/core-api';
	import ExternalProfilesManager from "./external-profiles-manager.svelte";
	import InstalledProfilesList from "./installed-profiles-list.svelte";
	import type { RegisteredProfile } from "./profile-types";
	import * as m from "$lib/paraglide/messages";

	let registered = $state<RegisteredProfile[]>([]);
	let busyId = $state<string | null>(null);
	/** The profile the remove confirm is open on — the trash icon used to delete on first tap. */
	let removing = $state<RegisteredProfile | null>(null);
	const removingName = $derived(removing?.name ?? '');

	async function confirmUninstall() {
		const target = removing;
		removing = null;
		if (target) await uninstall(target);
	}

	async function loadRegistered() {
		const { data } = await core.GET('/api/profiles');
		if (data) registered = data;
	}

	onMount(loadRegistered);

	async function uninstall(p: RegisteredProfile) {
		busyId = p.id;
		const { error } = await core.DELETE('/api/settings/profiles/{id}', { params: { path: { id: p.id } } });
		busyId = null;
		if (error) {
			toast.error(m.profiles_toast_uninstall_failed({ error: apiErrorText(error, m.conn_request_failed()) }));
			return;
		}
		toast.success(m.profiles_toast_uninstalled({ name: p.name }));
		await loadRegistered();
	}
</script>

<div class="flex flex-col gap-6">
	<InstalledProfilesList
		profiles={registered}
		{busyId}
		onUninstall={(p) => (removing = p)}
	/>

	{#if coreCapabilities.has('profileSources')}
		<ExternalProfilesManager onInstalled={loadRegistered} onRemoved={loadRegistered} />
	{/if}
</div>

<Dialog.Root open={removing !== null} onOpenChange={(v) => !v && (removing = null)}>
	<Dialog.Content>
		<Dialog.Header>
			<Dialog.Title>{m.profiles_uninstall_title({ name: removingName })}</Dialog.Title>
			<Dialog.Description>{m.profiles_uninstall_body()}</Dialog.Description>
		</Dialog.Header>
		<Dialog.Footer>
			<Button variant="outline" onclick={() => (removing = null)}>{m.action_cancel()}</Button>
			<Button variant="destructive" onclick={confirmUninstall}>{m.action_remove()}</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
