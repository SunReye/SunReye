<script lang="ts">
	import { api } from '$lib/api';
	import { Button } from '$lib/components/ui/button';
	import * as m from '$lib/paraglide/messages';
	import { type ProbeOutcome, describeProbe } from './add-device-logic';
	import type { DeviceView, NewConnection } from './device-types';

	// Probe a gateway draft through one of its devices — the existing test-read,
	// given the draft's address, that device's unit id and its profile. With no
	// device there is nothing to read, and the line says so.
	let { draft, device }: { draft: NewConnection; device: DeviceView | null } = $props();

	const WORDS = {
		ok: (count: number, ms: number) => m.devices_test_ok({ count, ms }),
		failed: (error: string) => m.conn_test_failed({ error })
	};

	let testing = $state(false);
	let result = $state<ProbeOutcome | null>(null);

	const host = $derived(draft.host.trim());
	const blocked = $derived(device === null || testing || host === '');
	const line = $derived(device === null ? { ok: null, message: m.devices_test_nothing() } : result);
	const lineClass = $derived(
		line?.ok === null ? 'text-muted-foreground' : line?.ok ? 'text-emerald-500' : 'text-destructive'
	);

	async function probe(target: DeviceView) {
		const { data, error } = await api.api.settings.inverter.test.post({
			...draft,
			host,
			unitId: target.unitId,
			profileId: target.profileId
		});
		return data ?? { ok: false, error: error ? String(error.value) : m.conn_request_failed() };
	}

	async function test() {
		if (!device) return;
		testing = true;
		result = null;
		result = describeProbe(await probe(device), WORDS);
		testing = false;
	}
</script>

<div class="flex flex-wrap items-center gap-x-3 gap-y-2 text-xs">
	<Button type="button" variant="outline" size="sm" disabled={blocked} onclick={test}>
		{testing ? m.conn_testing() : m.conn_test()}
	</Button>
	{#if line}
		<span class={lineClass}>{line.message}</span>
	{/if}
</div>
