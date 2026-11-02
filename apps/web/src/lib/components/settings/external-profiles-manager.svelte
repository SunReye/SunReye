<script lang="ts">
	import { onMount } from 'svelte';
	import { toast } from 'svelte-sonner';
	import { apiErrorText } from '$lib/api-error';
	import { core } from '$lib/core-api';
	import * as m from '$lib/paraglide/messages';
	import ProfileImport from './profile-import.svelte';
	import ProfileSourcesEditor from './profile-sources-editor.svelte';
	import type { Skipped, Source, StoredSource } from './profile-types';

	// Self-contained "add an external profile" surface: sources fetched by URL and single-file import.
	// Shared by the settings profiles form, the device dialogs and the first-run setup wizard.
	// `onInstalled` fires with one stored id (the first a source supplied, or the imported one) so the
	// parent can refresh its registered list and offer that profile.
	let { onInstalled }: { onInstalled?: (id: string) => void } = $props();

	let sources = $state<StoredSource[]>([]);
	let skipped = $state<Skipped[]>([]);
	let failure = $state<string | null>(null);
	let busy = $state(false);

	onMount(loadSources);

	async function loadSources() {
		try {
			const { data } = await core.GET('/api/settings/profile-sources');
			if (data) sources = data;
		} catch {
			// The list stays as it was; adding a source reports an unreachable core itself.
		}
	}

	/** The core's report of the add, or why it refused. A dead connection throws. */
	async function send(source: Source) {
		const { data, error } = await core.POST('/api/settings/profile-sources', { body: source });
		return data ?? { reason: apiErrorText(error, m.conn_request_failed()) };
	}

	async function add(source: Source) {
		failure = null;
		skipped = [];
		busy = true;
		try {
			const sent = await send(source);
			if ('reason' in sent) {
				failure = m.sources_add_failed({ error: sent.reason });
				return;
			}
			skipped = sent.skipped;
			await loadSources();
			const [first] = sent.profileIds;
			if (first === undefined) return;
			toast.success(m.sources_added({ count: sent.profileIds.length }));
			onInstalled?.(first);
		} catch {
			failure = m.sources_add_failed({ error: m.conn_request_failed() });
		} finally {
			busy = false;
		}
	}
</script>

<div class="flex flex-col gap-4">
	<ProfileSourcesEditor {sources} {busy} onAdd={add} />
	{#if failure}
		<p role="alert" class="text-sm text-destructive">{failure}</p>
	{/if}
	{#if skipped.length > 0}
		<div class="flex flex-col gap-1 text-sm">
			<p class="font-medium">{m.sources_skipped_title()}</p>
			<ul class="flex flex-col gap-0.5 text-muted-foreground">
				{#each skipped as file (file.path)}
					<li class="break-words">{m.sources_skipped_item({ path: file.path, reason: file.reason })}</li>
				{/each}
			</ul>
		</div>
	{/if}
	<ProfileImport onImported={onInstalled} />
</div>
