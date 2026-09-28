<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import RestartButton from '$lib/components/settings/restart-button.svelte';
	import * as m from '$lib/paraglide/messages';

	// The wizard's pinned action row, per step: Back on the left, the step's one
	// primary action on the right. Its own component so the page's template holds
	// the steps and nothing else.
	let {
		step,
		selectedName,
		canContinue,
		saving,
		activating,
		activated,
		onStep,
		onSaveConnection,
		onActivate
	}: {
		step: 'profile' | 'connect' | 'activate';
		selectedName: string | undefined;
		canContinue: boolean;
		saving: boolean;
		activating: boolean;
		activated: boolean;
		onStep: (step: 'profile' | 'connect' | 'activate') => void;
		onSaveConnection: () => void;
		onActivate: () => void;
	} = $props();

	type Step = 'profile' | 'connect' | 'activate';
	type Primary = { label: string; disabled: boolean; run: () => void };

	/** Where Back leads from each step; the first has none. */
	const BACK: Record<Step, Step | null> = { profile: null, connect: 'profile', activate: 'connect' };

	/** Each step's one primary action. */
	const PRIMARY: Record<Step, () => Primary> = {
		profile: () => ({
			label: m.action_continue(),
			disabled: !canContinue,
			run: () => onStep('connect')
		}),
		connect: () => ({
			label: saving ? m.action_saving() : m.action_continue(),
			disabled: saving,
			run: onSaveConnection
		}),
		activate: () => ({
			label: activating ? m.setup_activating() : m.setup_activate_title(),
			disabled: activating,
			run: onActivate
		})
	};

	const backTo = $derived(BACK[step]);
	const primary = $derived(PRIMARY[step]());
</script>

{#if activated}
	<Button variant="ghost" class="h-11 sm:h-9" onclick={() => location.reload()}>
		{m.setup_restarted_reload()}
	</Button>
	<RestartButton label={m.setup_restart_now()} />
{:else}
	{#if backTo}
		<Button variant="ghost" class="h-11 sm:h-9" onclick={() => onStep(backTo)}>
			{m.action_back()}
		</Button>
	{:else}
		<!-- The choice, echoed where the thumb is: the list may have scrolled it away. -->
		<span class="min-w-0 truncate text-sm text-muted-foreground">{selectedName ?? ''}</span>
	{/if}
	<Button class="h-11 sm:h-9" disabled={primary.disabled} onclick={primary.run}>
		{primary.label}
	</Button>
{/if}
