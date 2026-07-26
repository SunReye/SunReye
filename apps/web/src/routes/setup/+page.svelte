<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$lib/resolve';
	import { onMount } from 'svelte';
	import { toast } from 'svelte-sonner';
	import { api } from '$lib/api';
	import Logo from '$lib/components/logo.svelte';
	import { Button } from '$lib/components/ui/button';
	import InverterForm from '$lib/components/settings/inverter-form.svelte';
	import type { RegisteredProfile } from '$lib/components/settings/profile-types';
	import ActivateStep from '$lib/components/setup/activate-step.svelte';
	import ProfileStep from '$lib/components/setup/profile-step.svelte';
	import SetupStepper from '$lib/components/setup/setup-stepper.svelte';
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
			toast.error(m.setup_activate_failed({ error: String(error.value) }));
			return;
		}
		activated = true;
	}

	const steps: { key: Step; label: () => string }[] = [
		{ key: 'profile', label: m.setup_step_profile },
		{ key: 'connect', label: m.setup_step_connection },
		{ key: 'activate', label: m.setup_step_activate }
	];
	const currentStep = $derived(steps.findIndex((s) => s.key === step));
	const stepItems = $derived(steps.map((s) => ({ key: s.key, label: s.label() })));

	// The connection form test-reads against the chosen profile; `undefined`
	// lets the server fall back to the active one.
	const testProfileId = $derived(selectedId ?? undefined);
	const selectedName = $derived(selected?.name);
</script>

<div class="relative min-h-svh overflow-y-auto bg-background p-4">
	<div
		class="pointer-events-none absolute inset-0 opacity-[0.35] bg-[linear-gradient(to_right,var(--color-border)_1px,transparent_1px),linear-gradient(to_bottom,var(--color-border)_1px,transparent_1px)] bg-size-[44px_44px] mask-[radial-gradient(ellipse_at_center,black,transparent_75%)]"
		aria-hidden="true"
	></div>

	<div class="relative mx-auto flex w-full max-w-2xl flex-col gap-6 py-8">
		<div class="flex flex-col items-center gap-3 text-center">
			<Logo class="size-12 text-primary" />
			<div>
				<h1 class="text-xl font-semibold tracking-tight">{m.setup_title()}</h1>
				<p class="text-sm text-muted-foreground">
					{m.setup_subtitle()}
				</p>
			</div>
		</div>

		<SetupStepper steps={stepItems} current={currentStep} />

		{#if step === 'profile'}
			<ProfileStep
				profiles={registered}
				bind:selectedId
				onContinue={() => (step = 'connect')}
				{onExternalInstalled}
			/>
		{:else if step === 'connect'}
			<InverterForm profileId={testProfileId} />
			<div class="flex justify-between">
				<Button variant="ghost" onclick={() => (step = 'profile')}>{m.action_back()}</Button>
				<Button onclick={() => (step = 'activate')}>{m.action_continue()}</Button>
			</div>
		{:else}
			<ActivateStep
				profileName={selectedName}
				{activating}
				{activated}
				onActivate={activate}
				onBack={() => (step = 'connect')}
			/>
		{/if}
	</div>
</div>
