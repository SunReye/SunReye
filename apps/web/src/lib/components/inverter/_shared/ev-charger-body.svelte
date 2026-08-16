<script lang="ts">
	// One EVCC loadpoint's tile content, rendered either as a dialog trigger (admins
	// get the quick settings) or inside a plain read-only card. All structural nodes
	// are spans so the interactive variant is a valid <button>.
	import CarProfile from 'phosphor-svelte/lib/CarProfile';
	import { EVCC_MODES, evcc, type EvccLoadpoint } from '$lib/evcc/store.svelte';
	import * as m from '$lib/paraglide/messages';
	import AnimatedNumber from '$lib/components/inverter/animated-number.svelte';
	import EvVehicleRow from './ev-vehicle-row.svelte';

	let { lp }: { lp: EvccLoadpoint } = $props();

	const title = $derived(lp.title ?? m.evcc_card_title());
	const sessionKwh = $derived((lp.sessionEnergy ?? 0) / 1000);

	const statusText = $derived(
		lp.charging ? m.flow_charging() : lp.connected ? m.flow_plugged() : m.evcc_status_disconnected()
	);
	const statusClass = $derived(lp.charging ? 'text-amber-500' : '');

	const modeLabel = $derived(
		EVCC_MODES.find((x) => x.value === lp.mode)?.label() ?? (lp.mode ?? '—')
	);
</script>

<span class="flex items-start justify-between gap-2">
	<span
		class="text-[0.65rem] font-medium uppercase tracking-wider text-muted-foreground sm:text-xs 2xl:text-sm"
	>
		{title}
	</span>
	<span
		class="flex size-8 shrink-0 items-center justify-center rounded-lg bg-energy-ev/15 2xl:size-10"
	>
		<CarProfile class="size-4.5 text-energy-ev 2xl:size-5" weight="duotone" />
	</span>
</span>
<!-- Primary headline: energy added this charging session, in kWh — the same
     unit the daily-energy tiles lead with, so the whole strip reads as one row
     of kWh figures. The live charge power moves down into the status line. -->
<span class="text-2xl font-semibold tabular-nums leading-none xl:text-3xl">
	<AnimatedNumber value={sessionKwh} unit="kWh" intervalMs={evcc.cadenceMs} />
	<span class="ml-1 text-sm font-normal text-muted-foreground 2xl:text-base">kWh</span>
</span>
<span class="flex items-center justify-between gap-2 text-xs text-muted-foreground">
	<span class="flex min-w-0 items-center gap-1.5">
		<span class={statusClass}>{statusText}</span>
		{#if lp.charging}
			<span aria-hidden="true" class="text-muted-foreground/50">·</span>
			<span class="tabular-nums text-foreground/80">
				<AnimatedNumber
					value={lp.chargePowerLive / 1000}
					unit="kW"
					intervalMs={evcc.cadenceMs}
				/> kW
			</span>
		{/if}
	</span>
	{#if lp.mode}
		<span
			class="shrink-0 rounded-full border border-border px-2 py-0.5 text-[0.65rem] font-medium"
		>
			{modeLabel}
		</span>
	{/if}
</span>
<EvVehicleRow {lp} />
