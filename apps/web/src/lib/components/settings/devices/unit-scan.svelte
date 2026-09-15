<script lang="ts">
	import { api } from '$lib/api';
	import { Button } from '$lib/components/ui/button';
	import * as m from '$lib/paraglide/messages';
	import { type UnitScanTarget, scanOutcome } from './unit-scan-logic';

	// MEASURE the unit id instead of asking for it. The number means different
	// things on different framings — a gateway answered 0 and timed out on 1 while
	// a Solarman stick on the SAME inverter answered 1 and timed out on 0 — so
	// there is nothing to default it to and nothing an operator can read off a
	// label. `./unit-scan-logic.ts` has the measurements.
	//
	// TARGET IN, ID OUT, and no form of its own: the device dialog, the wizard and
	// the onboarding page hold three different shapes of endpoint, and a component
	// that bound to one of them could only ever serve that one.
	let {
		target,
		onFound,
		nothing
	}: {
		/** What to scan, or null while the form cannot say — then `nothing` is shown. */
		target: UnitScanTarget | null;
		onFound: (unitId: number) => void;
		nothing: string;
	} = $props();

	const WORDS = {
		found: (args: { unitId: number; ms: number }) => m.devices_unit_scan_found(args),
		none: (args: { ids: string }) => m.devices_unit_scan_none(args)
	};

	let scanning = $state(false);
	let outcome = $state<{ ok: boolean; message: string } | null>(null);

	const line = $derived(target === null ? { ok: false, message: nothing } : outcome);
	const lineClass = $derived(line?.ok ? 'text-emerald-500' : 'text-muted-foreground');

	async function scan() {
		if (!target) return;
		scanning = true;
		outcome = null;
		const { data, error } = await api.api.connections['scan-units'].post(target);
		scanning = false;
		const found = scanOutcome(data, error, WORDS, m.conn_request_failed());
		if (found.unitId !== undefined) onFound(found.unitId);
		outcome = found;
	}
</script>

<div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
	<Button
		type="button"
		variant="outline"
		size="sm"
		disabled={target === null || scanning}
		onclick={scan}
	>
		{scanning ? m.devices_unit_scanning() : m.devices_unit_scan()}
	</Button>
	{#if line}
		<span class={lineClass}>{line.message}</span>
	{/if}
</div>
