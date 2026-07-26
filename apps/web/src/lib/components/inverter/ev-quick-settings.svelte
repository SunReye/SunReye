<script lang="ts">
	import Gauge from 'phosphor-svelte/lib/Gauge';
	import Path from 'phosphor-svelte/lib/Path';
	import BatteryCharging from 'phosphor-svelte/lib/BatteryCharging';
	import { toast } from 'svelte-sonner';
	import { Button } from '$lib/components/ui/button';
	import { Slider } from '$lib/components/ui/slider';
	import { displayLimitSoc, EVCC_MODES, evcc, type EvccLoadpoint } from '$lib/evcc/store.svelte';
	import { socColor } from '$lib/inverter/power-graph';
	import * as m from '$lib/paraglide/messages';

	let { lp }: { lp: EvccLoadpoint } = $props();

	const kwh = (wh: number) => (wh / 1000).toLocaleString(undefined, { maximumFractionDigits: 1 });

	let busy = $state(false);
	// The slider's uncommitted position; the live limit wins until the user drags.
	let pendingLimit = $state<number | null>(null);
	const limit = $derived(pendingLimit ?? displayLimitSoc(lp));
	// EVCC treats a limit of 0 as "charge without a target".
	const limitLabel = $derived(limit === 0 ? m.evcc_limit_none() : `${limit}%`);
	const sessionLabel = $derived(
		lp.sessionEnergy === null ? '—' : `${kwh(lp.sessionEnergy)} kWh`
	);
	/** Only the loadpoint's current mode is filled. */
	const modeVariant = (mode: string): 'default' | 'secondary' =>
		lp.mode === mode ? 'default' : 'secondary';

	async function send(action: Promise<string | null>) {
		busy = true;
		const error = await action;
		busy = false;
		if (error) toast.error(m.evcc_command_error({ error }));
	}
</script>

<div class="flex flex-col gap-5">
	<!-- Charge mode: one button per EVCC mode, the active one filled. -->
	<div class="flex flex-col gap-2">
		<span class="text-xs font-medium uppercase tracking-wide text-muted-foreground">
			{m.evcc_mode()}
		</span>
		<div class="grid grid-cols-4 gap-2">
			{#each EVCC_MODES as { value, label } (value)}
				<Button
					size="sm"
					variant={modeVariant(value)}
					disabled={busy}
					onclick={() => send(evcc.setMode(lp.index, value))}
				>
					{label()}
				</Button>
			{/each}
		</div>
	</div>

	<!-- Charge limit: EVCC's effective (resolved) limit, 0 meaning "no limit". -->
	<div class="flex flex-col gap-2">
		<div class="flex items-baseline justify-between gap-2">
			<span class="text-xs font-medium uppercase tracking-wide text-muted-foreground">
				{m.evcc_limit()}
			</span>
			<span class="text-xs tabular-nums text-muted-foreground">
				{limitLabel}
			</span>
		</div>
		<Slider
			type="single"
			value={limit}
			min={0}
			max={100}
			step={5}
			disabled={busy}
			onValueChange={(v) => (pendingLimit = v)}
			onValueCommit={(v) => send(evcc.setLimitSoc(lp.index, v))}
		/>
	</div>

	<!-- Session stats -->
	<div class="grid grid-cols-2 gap-3 border-t border-border/60 pt-4 text-sm">
		<div class="flex items-center gap-2">
			<BatteryCharging class="size-4 text-muted-foreground" weight="duotone" />
			<span class="tabular-nums">
				{sessionLabel}
			</span>
			<span class="text-xs text-muted-foreground">{m.evcc_session()}</span>
		</div>
		{#if lp.vehicleRange !== null}
			<div class="flex items-center gap-2">
				<Path class="size-4 text-muted-foreground" weight="duotone" />
				<span class="tabular-nums">{Math.round(lp.vehicleRange)} km</span>
			</div>
		{/if}
		{#if lp.vehicleSoc !== null}
			<div class="flex items-center gap-2">
				<Gauge class="size-4 text-muted-foreground" weight="duotone" />
				<span class="tabular-nums" style={`color:${socColor(lp.vehicleSoc)}`}>
					{Math.round(lp.vehicleSoc)}%
				</span>
			</div>
		{/if}
	</div>
</div>
