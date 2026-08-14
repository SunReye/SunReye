<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$lib/resolve';
	import { onMount } from 'svelte';
	import { toast } from 'svelte-sonner';
	import Check from 'phosphor-svelte/lib/Check';
	import { api } from '$lib/api';
	import Logo from '$lib/components/logo.svelte';
	import { Button } from '$lib/components/ui/button';
	import InverterForm from '$lib/components/settings/inverter-form.svelte';
	import type { RegisteredProfile } from '$lib/components/settings/profile-types';
	import ActivateStep from '$lib/components/setup/activate-step.svelte';
	import ProfileStep from '$lib/components/setup/profile-step.svelte';
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
	// means the post-activation restart boots polling against nothing.
	let connectForm = $state<ReturnType<typeof InverterForm> | null>(null);
	async function continueFromConnect() {
		if (await connectForm?.save()) step = 'activate';
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

		<ol class="flex items-start">
			{#each steps as s, i (s.key)}
				{@const state = i < currentStep ? 'done' : i === currentStep ? 'current' : 'upcoming'}
				<li class="flex flex-1 flex-col items-center gap-2">
					<div class="flex w-full items-center">
						<span
							class="h-px flex-1 {i === 0
								? 'bg-transparent'
								: i <= currentStep
									? 'bg-primary'
									: 'bg-border'}"
						></span>
						<span
							class="flex size-8 shrink-0 items-center justify-center rounded-full border text-sm font-medium transition-colors {state ===
							'done'
								? 'border-primary bg-primary text-primary-foreground'
								: state === 'current'
									? 'border-primary text-primary'
									: 'border-border text-muted-foreground'}"
						>
							{#if state === 'done'}
								<Check class="size-4" weight="bold" />
							{:else}
								{i + 1}
							{/if}
						</span>
						<span
							class="h-px flex-1 {i === steps.length - 1
								? 'bg-transparent'
								: i < currentStep
									? 'bg-primary'
									: 'bg-border'}"
						></span>
					</div>
					<span
						class="text-center text-xs {state === 'upcoming'
							? 'text-muted-foreground'
							: 'font-medium text-foreground'}"
					>
						{s.label()}
					</span>
				</li>
			{/each}
		</ol>

		{#if step === 'profile'}
			<ProfileStep
				profiles={registered}
				bind:selectedId
				onContinue={() => (step = 'connect')}
				{onExternalInstalled}
			/>
		{:else if step === 'connect'}
			<InverterForm bind:this={connectForm} profileId={selectedId ?? undefined} />
			<div class="flex justify-between">
				<Button variant="ghost" onclick={() => (step = 'profile')}>{m.action_back()}</Button>
				<Button onclick={continueFromConnect}>{m.action_continue()}</Button>
			</div>
		{:else}
			<ActivateStep
				profileName={selected?.name}
				{activating}
				{activated}
				onActivate={activate}
				onBack={() => (step = 'connect')}
			/>
		{/if}
	</div>
</div>
