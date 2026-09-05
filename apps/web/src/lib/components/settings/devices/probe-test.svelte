<script lang="ts">
	import { api } from '$lib/api';
	import { Button } from '$lib/components/ui/button';
	import * as m from '$lib/paraglide/messages';
	import type { TestResult } from '../inverter-types';
	import SnapshotDialog from '../snapshot-dialog.svelte';
	import { type ProbeTarget, describeProbe } from './add-device-logic';

	// One test-read against a target — an address, a slave id, a profile — and
	// the same snapshot the inverter form always offered on success: the first
	// values read, for a plausibility check before anything is saved. With no
	// target (no profile chosen, no gateway yet) the line says why.
	let { target, nothing }: { target: ProbeTarget | null; nothing: string } = $props();

	const WORDS = {
		ok: (count: number, ms: number) => m.devices_test_ok({ count, ms }),
		failed: (error: string) => m.conn_test_failed({ error })
	};

	let testing = $state(false);
	let result = $state<TestResult | null>(null);
	let snapshotOpen = $state(false);

	const blocked = $derived(target === null || testing || target.host.trim() === '');
	const outcome = $derived(result ? describeProbe(result, WORDS) : null);
	const line = $derived(target === null ? { ok: null, message: nothing } : outcome);
	const lineClass = $derived(
		line?.ok === null ? 'text-muted-foreground' : line?.ok ? 'text-emerald-500' : 'text-destructive'
	);
	const hasSnapshot = $derived((result?.metrics?.length ?? 0) > 0);

	async function probe(t: ProbeTarget): Promise<TestResult> {
		const { data, error } = await api.api.settings.inverter.test.post({ ...t, host: t.host.trim() });
		return data ?? { ok: false, error: error ? String(error.value) : m.conn_request_failed() };
	}

	async function test() {
		if (!target) return;
		testing = true;
		result = null;
		result = await probe(target);
		testing = false;
		// On success, surface the captured snapshot for a plausibility check.
		snapshotOpen = hasSnapshot;
	}
</script>

<div class="flex flex-wrap items-center gap-x-3 gap-y-2 text-xs">
	<Button type="button" variant="outline" size="sm" disabled={blocked} onclick={test}>
		{testing ? m.conn_testing() : m.conn_test()}
	</Button>
	{#if hasSnapshot}
		<Button type="button" variant="ghost" size="sm" onclick={() => (snapshotOpen = true)}>
			{m.inverter_view_snapshot()}
		</Button>
	{/if}
	{#if line}
		<span class={lineClass}>{line.message}</span>
	{/if}
</div>

<SnapshotDialog bind:open={snapshotOpen} {result} />
