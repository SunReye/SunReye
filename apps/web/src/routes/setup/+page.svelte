<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$lib/resolve';
	import { onMount } from 'svelte';
	import { toast } from 'svelte-sonner';
	import { api } from '$lib/api';
	import { apiErrorText } from '$lib/api-error';
	import InverterForm from '$lib/components/settings/inverter-form.svelte';
	import type { RegisteredProfile } from '$lib/components/settings/profile-types';
	import ActivateStep from '$lib/components/setup/activate-step.svelte';
	import ProfileStep from '$lib/components/setup/profile-step.svelte';
	import SetupFooter from '$lib/components/setup/setup-footer.svelte';
	import SetupShell from '$lib/components/setup/setup-shell.svelte';
	import { firstRunGate } from '$lib/setup';
	import * as m from '$lib/paraglide/messages';
	import { useAppSession } from '$lib/session';

	const sessionQuery = useAppSession();

	// Gate the wizard (mirrors the app shell), same precedence: no session →
	// `/login`; no admin yet → `/onboarding`; already configured → `/`. Only a
	// logged-in, admin-created, profile-less instance stays here.
	$effect(() => {
		if (!$sessionQuery.isPending && !$sessionQuery.data) goto(resolve('/login'));
	});
	$effect(() => {
		if ($sessionQuery.isPending || !$sessionQuery.data) return;
		firstRunGate().then((g) => {
			if (g === 'setup-account') goto(resolve('/onboarding'));
			else if (g === 'ready') goto(resolve('/'));
		});
	});

	type Step = 'profile' | 'connect' | 'activate';
	let step = $state<Step>('profile');

	// The connection step's Continue must *save* the config: the form's own Save
	// button is easy to walk past after a successful test, and an unsaved host
	// means the post-activation restart boots polling against nothing. So the
	// form offers no Save of its own here (`wizard`) — Continue is the save.
	let connectForm = $state<ReturnType<typeof InverterForm> | null>(null);
	let saving = $state(false);
	async function continueFromConnect() {
		saving = true;
		const saved = await connectForm?.save();
		saving = false;
		if (saved) step = 'activate';
	}

	let registered = $state<RegisteredProfile[]>([]);
	let selectedId = $state<string | null>(null);
	const selected = $derived(registered.find((p) => p.id === selectedId) ?? null);

	let activating = $state(false);
	let activated = $state(false);

	async function loadRegistered() {
		const { data } = await api.api.profiles.get();
		if (data) registered = data as RegisteredProfile[];
	}
	onMount(loadRegistered);

	async function onExternalInstalled(id: string) {
		selectedId = id;
		await loadRegistered();
	}

	async function activate() {
		if (!selectedId) return;
		activating = true;
		const { error } = await api.api.settings['active-profile'].put({ id: selectedId });
		activating = false;
		if (error) {
			toast.error(m.setup_activate_failed({ error: apiErrorText(error.value, m.conn_request_failed()) }));
			return;
		}
		activated = true;
	}

	// The connection form test-reads against the chosen profile; `undefined`
	// lets the server fall back to the active one.
	const testProfileId = $derived(selectedId ?? undefined);
	const selectedName = $derived(selected?.name);
</script>

<SetupShell title={m.setup_title()} subtitle={m.setup_subtitle()} {step}>
	{#if step === 'profile'}
		<ProfileStep profiles={registered} bind:selectedId {onExternalInstalled} />
	{:else if step === 'connect'}
		<InverterForm bind:this={connectForm} profileId={testProfileId} wizard />
	{:else}
		<ActivateStep profileName={selectedName} {activated} />
	{/if}

	{#snippet footer()}
		<SetupFooter
			{step}
			{selectedName}
			canContinue={selectedId !== null}
			{saving}
			{activating}
			{activated}
			onStep={(next) => (step = next)}
			onSaveConnection={continueFromConnect}
			onActivate={activate}
		/>
	{/snippet}
</SetupShell>
