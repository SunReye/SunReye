<script lang="ts">
	import Section from '$lib/components/layout/section.svelte';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Progress } from '$lib/components/ui/progress';
	import type { Guarded, ImportReport, Outcome } from '$lib/archive-import/import-client';
	import * as m from '$lib/paraglide/messages';
	import GuardDialog from './guard-dialog.svelte';
	import ImportResult from './import-result.svelte';

	// Upload a 3.x archive, stop at the automation guard when the core raises it, and show what landed.
	// `upload` and `confirm` are the core's two routes; the page binds them to the client.
	let {
		upload,
		confirm,
		onDone
	}: {
		upload: (file: File, onProgress: (sent: number, total: number) => void) => Promise<Outcome>;
		confirm: (sha256: string) => Promise<Outcome>;
		onDone: () => void;
	} = $props();

	// Bound so the input is cleared through the component's own binding.
	let picked = $state<string | undefined>();
	let phase = $state<'idle' | 'uploading' | 'confirming'>('idle');
	let sent = $state(0);
	let total = $state(0);
	let failure = $state<string | null>(null);
	let guarded = $state<Guarded | null>(null);
	let report = $state<ImportReport | null>(null);

	const busy = $derived(phase !== 'idle');
	const percent = $derived(total === 0 ? 0 : Math.floor((sent * 100) / total));
	const status = $derived(
		phase === 'uploading' && percent < 100 ? m.import_uploading({ percent }) : m.import_importing()
	);

	function settle(outcome: Outcome) {
		phase = 'idle';
		if (outcome.kind === 'imported') report = outcome.report;
		else if (outcome.kind === 'guarded') guarded = outcome.guarded;
		else failure = outcome.message;
	}

	async function pick(event: Event & { currentTarget: HTMLInputElement }) {
		const input = event.currentTarget;
		const file = input.files?.[0];
		if (!file) return;
		// Picking the same file again must fire `change` again.
		picked = '';
		failure = null;
		report = null;
		sent = 0;
		total = 0;
		phase = 'uploading';
		settle(
			await upload(file, (done, all) => {
				sent = done;
				total = all;
			})
		);
	}

	async function proceed(sha256: string) {
		phase = 'confirming';
		guarded = null;
		settle(await confirm(sha256));
	}
</script>

<Section title={m.import_title()}>
	<div class="flex flex-col gap-1.5">
		<p class="text-sm text-muted-foreground">{m.import_intro()}</p>
		<Label for="import-archive">{m.import_file_label()}</Label>
		<Input
			id="import-archive"
			type="file"
			accept=".gz,.tgz,application/gzip"
			bind:value={picked}
			disabled={busy}
			onchange={pick}
		/>
		{#if busy}
			<p class="text-sm" aria-live="polite">{status}</p>
		{/if}
		{#if phase === 'uploading'}
			<Progress value={percent} />
		{/if}
		{#if failure}
			<p role="alert" class="text-sm text-destructive">{failure}</p>
		{/if}
	</div>
</Section>

{#if report}
	<div role="region" aria-label={m.import_result_title()}>
		<ImportResult {report} {onDone} />
	</div>
{/if}

<GuardDialog {guarded} {busy} onContinue={proceed} onCancel={() => (guarded = null)} />
