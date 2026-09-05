<script lang="ts">
	import type { Snippet } from 'svelte';
	import { Badge } from '$lib/components/ui/badge';
	import StatusBadge from './status-badge.svelte';
	import type { RegisteredProfile } from './profile-types';
	import * as m from '$lib/paraglide/messages';

	// One profile in a list: the name with its state badges on the left, the
	// caller's controls on the right. Shared by the settings profiles panel and
	// the first-run wizard, which differ only in badges and actions.
	let {
		profile,
		active = false,
		pending = false,
		detail = '',
		actions
	}: {
		profile: RegisteredProfile;
		/** Marks the profile the engine is running. */
		active?: boolean;
		/** Marks a profile queued to become active on the next restart. */
		pending?: boolean;
		/** Appended to the manufacturer/version line. */
		detail?: string;
		actions: Snippet;
	} = $props();

	const version = $derived(profile.version ? ` · v${profile.version}` : '');
</script>

<div class="flex flex-col gap-3 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
	<div class="flex min-w-0 flex-col gap-1">
		<span class="flex flex-wrap items-center gap-1.5 text-sm font-medium">
			<span class="wrap-break-word">{profile.name}</span>
			{#if active}
				<StatusBadge ok label={m.profiles_active()} />
			{/if}
			{#if pending}
				<Badge
					variant="outline"
					class="border-amber-500/50 bg-amber-500/10 text-amber-700 dark:text-amber-400"
				>
					<span class="mr-1.5 inline-block size-1.5 rounded-full bg-amber-500"></span>
					{m.profiles_restart_to_activate()}
				</Badge>
			{/if}
			{#if profile.builtin}
				<StatusBadge label={m.badge_builtin()} />
			{/if}
		</span>
		<span class="text-xs text-muted-foreground">
			{profile.manufacturer}{version}{detail}
		</span>
	</div>
	<div class="flex shrink-0 items-center gap-2">
		{@render actions()}
	</div>
</div>
