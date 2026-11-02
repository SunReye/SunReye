<script lang="ts">
	import { toast } from 'svelte-sonner';
	import { apiErrorText } from '$lib/api-error';
	import Section from '$lib/components/layout/section.svelte';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { core } from '$lib/core-api';
	import * as m from '$lib/paraglide/messages';

	// `onImported` fires with the stored id so the parent can refresh its profile list.
	let { onImported }: { onImported?: (id: string) => void } = $props();

	let failure = $state<string | null>(null);
	let busy = $state(false);

	/** The stored id, or why the core refused the file. A dead connection throws. */
	async function send(file: File): Promise<{ id: string } | { reason: string }> {
		const { data, error } = await core.POST('/api/settings/profiles/import', {
			body: await file.text(),
			// The core validates the file's own text; JSON-encoding it again would quote it.
			bodySerializer: (body) => body,
			headers: { 'Content-Type': 'text/plain' }
		});
		return data ?? { reason: apiErrorText(error, m.conn_request_failed()) };
	}

	async function pick(event: Event & { currentTarget: HTMLInputElement }) {
		const input = event.currentTarget;
		const file = input.files?.[0];
		if (!file) return;
		failure = null;
		busy = true;
		try {
			const sent = await send(file);
			if ('id' in sent) {
				toast.success(m.profile_import_success({ id: sent.id }));
				onImported?.(sent.id);
			} else {
				failure = m.profile_import_failed({ error: sent.reason });
			}
		} catch {
			failure = m.profile_import_failed({ error: m.conn_request_failed() });
		} finally {
			busy = false;
			// Picking the same file again must fire `change` again.
			input.value = '';
		}
	}
</script>

<Section title={m.profile_import_title()}>
	<div class="flex flex-col gap-1.5">
		<Label for="profile-import">{m.profile_import_label()}</Label>
		<Input
			id="profile-import"
			type="file"
			accept=".json,application/json"
			disabled={busy}
			onchange={pick}
		/>
		{#if failure}
			<p role="alert" class="text-sm text-destructive">{failure}</p>
		{/if}
	</div>
</Section>
