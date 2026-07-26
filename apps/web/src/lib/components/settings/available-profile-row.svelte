<script lang="ts">
	import { Button } from "$lib/components/ui/button";
	import { repoLabel } from "./repo-label";
	import StatusBadge from "./status-badge.svelte";
	import type { AvailableProfile, Source } from "./profile-types";
	import * as m from "$lib/paraglide/messages";

	let {
		profile,
		sources,
		busyId,
		onInstall
	}: {
		profile: AvailableProfile;
		sources: Source[];
		busyId: string | null;
		onInstall: (p: AvailableProfile) => void;
	} = $props();

	const source = $derived(repoLabel(profile.source, sources));
	const description = $derived(profile.description ? ` · ${profile.description}` : "");
	const installedLabel = $derived(
		m.profiles_installed_v({ version: profile.installedVersion ?? "" })
	);
	const busy = $derived(busyId === profile.id);
</script>

<div class="flex items-center justify-between gap-4 py-2.5">
	<div class="flex min-w-0 flex-col">
		<span class="wrap-break-word text-sm font-medium">{profile.name}</span>
		<div class="flex min-w-0 flex-col text-xs text-muted-foreground sm:flex-row sm:gap-1">
			<span class="truncate">
				{profile.manufacturer} · v{profile.version}{description}
			</span>
			<span class="truncate sm:before:mr-1 sm:before:content-['·']">{source}</span>
		</div>
	</div>
	<div class="shrink-0">
		{#if profile.updateAvailable}
			<Button size="sm" disabled={busy} onclick={() => onInstall(profile)}>
				{m.profiles_update_to({ version: profile.version })}
			</Button>
		{:else if profile.installed}
			<StatusBadge ok label={installedLabel} />
		{:else}
			<Button size="sm" disabled={busy} onclick={() => onInstall(profile)}>
				{m.profiles_download()}
			</Button>
		{/if}
	</div>
</div>
