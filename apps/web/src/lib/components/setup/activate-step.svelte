<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import Section from '$lib/components/layout/section.svelte';
	import * as m from '$lib/paraglide/messages';
	import RestartButton from '$lib/components/settings/restart-button.svelte';

	let {
		profileName,
		activating,
		activated,
		onActivate,
		onBack
	}: {
		profileName: string | undefined;
		activating: boolean;
		activated: boolean;
		onActivate: () => void;
		onBack: () => void;
	} = $props();

	const displayName = $derived(profileName ?? '');
	const activateLabel = $derived(activating ? m.setup_activating() : m.setup_activate_title());
</script>

<!-- The wizard renders outside the (app) shell, so this card is the ONLY thing
     padding the step: no PageShell gutter above it, and nothing of its own here
     — Section's pad is the whole measure. Not `nested` for the same reason. -->
<Section title={m.setup_activate_title()}>
	{#if activated}
		<div
			class="flex items-start gap-2 border border-amber-500/50 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-400"
		>
			<span class="mt-1.5 inline-block size-2 shrink-0 rounded-full bg-amber-500"></span>
			<div class="flex flex-col gap-1">
				<span class="font-medium">{m.setup_activated_msg({ name: displayName })}</span>
				<span>{m.setup_activated_desc()}</span>
			</div>
		</div>
		<div class="flex items-center justify-end gap-2">
			<Button variant="ghost" onclick={() => location.reload()}>{m.setup_restarted_reload()}</Button>
			<RestartButton label={m.setup_restart_now()} />
		</div>
	{:else}
		<p class="text-sm text-muted-foreground">{m.setup_activate_desc({ name: displayName })}</p>
		<div class="flex justify-between">
			<Button variant="ghost" onclick={onBack}>{m.action_back()}</Button>
			<Button disabled={activating} onclick={onActivate}>
				{activateLabel}
			</Button>
		</div>
	{/if}
</Section>
