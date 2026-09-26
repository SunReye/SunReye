<script lang="ts">
	import Section from '$lib/components/layout/section.svelte';
	import * as m from '$lib/paraglide/messages';

	// The last step's body: what activating does, then — once it has — that the
	// server needs a restart. Its buttons live in the wizard's sticky footer
	// with every other step's, so the primary action is always in one place.
	let {
		profileName,
		activated
	}: {
		profileName: string | undefined;
		activated: boolean;
	} = $props();

	const displayName = $derived(profileName ?? '');
</script>

<!-- The wizard renders outside the (app) shell, so this card is the ONLY thing
     padding the step: no PageShell gutter above it, and nothing of its own here
     — Section's pad is the whole measure. Not `nested` for the same reason. -->
<Section title={m.setup_activate_title()}>
	{#if activated}
		<div
			class="flex items-start gap-2 border border-amber-500/50 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-400"
			role="status"
		>
			<span class="mt-1.5 inline-block size-2 shrink-0 rounded-full bg-amber-500"></span>
			<div class="flex flex-col gap-1">
				<span class="font-medium">{m.setup_activated_msg({ name: displayName })}</span>
				<span>{m.setup_activated_desc()}</span>
			</div>
		</div>
	{:else}
		<p class="text-sm text-muted-foreground">{m.setup_activate_desc({ name: displayName })}</p>
	{/if}
</Section>
