<script lang="ts">
	import { onMount } from 'svelte';
	import { toast } from 'svelte-sonner';
	import { api } from '$lib/api';
	import * as m from '$lib/paraglide/messages';
	import AvailableProfilesBrowser from './available-profiles-browser.svelte';
	import ProfileSourcesEditor from './profile-sources-editor.svelte';
	import { apiErrorMessage } from './api-error';
	import type { AvailableProfile, Source } from './profile-types';

	// Self-contained "add an external profile" surface: manage git repo sources,
	// browse them, and download a profile. Shared by the settings profiles form
	// and the first-run setup wizard so the source/browse/install flow lives once.
	// `onInstalled` fires with the downloaded id so the parent can refresh its
	// registered list (and, in settings, flag a required restart).
	let { onInstalled }: { onInstalled?: (id: string) => void } = $props();

	let sources = $state<Source[]>([]);
	let available = $state<AvailableProfile[] | null>(null);
	let browseErrors = $state<{ source: string; error: string }[]>([]);
	let savingSources = $state(false);
	let browsing = $state(false);
	let busyId = $state<string | null>(null);

	onMount(loadSources);

	async function loadSources() {
		const { data } = await api.api.settings['profile-sources'].get();
		if (data) sources = data.sources;
	}

	// Persist optimistically: apply `next` locally, save, and roll back to the
	// previous set if the server rejects it — so add/remove/toggle each save
	// without a manual button.
	async function persist(next: Source[]) {
		const prev = sources;
		sources = next;
		savingSources = true;
		const { error } = await api.api.settings['profile-sources'].put({ sources: next });
		savingSources = false;
		if (error) {
			sources = prev;
			toast.error(
				m.profiles_toast_save_failed({ error: apiErrorMessage(error.value, m.error_unknown()) })
			);
		}
	}

	function addSource(url: string) {
		void persist([...sources, { url, enabled: true }]);
	}
	function removeSource(url: string) {
		void persist(sources.filter((s) => s.url !== url));
	}
	function toggleSource(url: string, enabled: boolean) {
		void persist(sources.map((s) => (s.url === url ? { ...s, enabled } : s)));
	}
	async function browse() {
		browsing = true;
		available = null;
		browseErrors = [];
		const { data, error } = await api.api.profiles.available.get();
		browsing = false;
		if (error || !data) {
			toast.error(m.profiles_toast_browse_failed());
			return;
		}
		available = data.profiles as AvailableProfile[];
		browseErrors = data.errors;
	}
	async function install(p: AvailableProfile) {
		busyId = p.id;
		const { error } = await api.api.profiles.install.post({ source: p.source, id: p.id });
		busyId = null;
		if (error) {
			toast.error(m.profiles_toast_install_failed({ error: String(error.value) }));
			return;
		}
		toast.success(m.profiles_toast_download_success({ name: p.name }));
		onInstalled?.(p.id);
		await browse();
	}
</script>

<div class="flex flex-col gap-4">
	<ProfileSourcesEditor
		{sources}
		saving={savingSources}
		onAdd={addSource}
		onRemove={removeSource}
		onToggle={toggleSource}
	/>
	<AvailableProfilesBrowser
		{available}
		{sources}
		errors={browseErrors}
		{browsing}
		{busyId}
		onBrowse={browse}
		onInstall={install}
	/>
</div>
