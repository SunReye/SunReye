<script lang="ts">
	import CarProfile from 'phosphor-svelte/lib/CarProfile';
	import * as Dialog from '$lib/components/ui/dialog';
	import { EVCC_MODES, evcc, type EvccLoadpoint } from '$lib/evcc/store.svelte';
	import { useAppSession } from '$lib/session';
	import * as m from '$lib/paraglide/messages';
	import AnimatedNumber from './animated-number.svelte';
	import EvQuickSettings from './ev-quick-settings.svelte';
	import EvSocMeter from './ev-soc-meter.svelte';

	// Same tile surface as the daily-energy cards so the strip reads as one row.
	const CARD_CLASS =
		'flex w-full flex-col gap-2 rounded-xl border border-border/60 bg-card p-3 text-left sm:p-4';
	const TRIGGER_CLASS = `${CARD_CLASS} transition-colors hover:border-border hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring`;

	const session = useAppSession();
	// Commands are admin-only server-side; everyone else gets the read-only tile.
	const isAdmin = $derived($session.data?.user.role === 'admin');

	$effect(() => evcc.connect());

	const statusText = (lp: EvccLoadpoint) =>
		lp.charging ? m.flow_charging() : lp.connected ? m.flow_plugged() : m.evcc_status_disconnected();

	const modeLabel = (mode: string | null) =>
		EVCC_MODES.find((x) => x.value === mode)?.label() ?? (mode ?? '—');
</script>

{#snippet body(lp: EvccLoadpoint)}
	<span class="flex items-start justify-between gap-2">
		<span
			class="text-[0.65rem] font-medium uppercase tracking-wider text-muted-foreground sm:text-xs 2xl:text-sm"
		>
			{lp.title ?? m.evcc_card_title()}
		</span>
		<span class="flex size-8 shrink-0 items-center justify-center rounded-lg bg-chart-2/15 2xl:size-10">
			<CarProfile class="size-4.5 text-chart-2 2xl:size-5" weight="duotone" />
		</span>
	</span>
	<!-- Primary headline: energy added this charging session, in kWh — the same
	     unit the daily-energy tiles lead with, so the whole strip reads as one row
	     of kWh figures. The live charge power moves down into the status line. -->
	<span class="text-2xl font-semibold tabular-nums leading-none xl:text-3xl">
		<AnimatedNumber value={(lp.sessionEnergy ?? 0) / 1000} unit="kWh" />
		<span class="ml-1 text-sm font-normal text-muted-foreground 2xl:text-base">kWh</span>
	</span>
	<span class="flex items-center justify-between gap-2 text-xs text-muted-foreground">
		<span class="flex min-w-0 items-center gap-1.5">
			<span class={lp.charging ? 'text-amber-500' : ''}>{statusText(lp)}</span>
			{#if lp.charging}
				<span aria-hidden="true" class="text-muted-foreground/50">·</span>
				<span class="tabular-nums text-foreground/80">
					<AnimatedNumber value={lp.chargePower / 1000} unit="kW" /> kW
				</span>
			{/if}
		</span>
		{#if lp.mode}
			<span
				class="shrink-0 rounded-full border border-border px-2 py-0.5 text-[0.65rem] font-medium"
			>
				{modeLabel(lp.mode)}
			</span>
		{/if}
	</span>
	<!-- Vehicle SoC meter (see EvSocMeter); when there's no SoC but a vehicle is
	     named, still show its title so the row height stays consistent. -->
	{#if lp.vehicleSoc !== null}
		<EvSocMeter {lp} />
	{:else if lp.vehicleTitle}
		<span class="flex items-baseline gap-2 border-t border-border/40 pt-2 text-xs">
			<span class="min-w-0 truncate text-muted-foreground">{lp.vehicleTitle}</span>
		</span>
	{/if}
{/snippet}

{#if evcc.active}
	<div class="flex flex-col gap-3 sm:gap-4">
		{#each evcc.loadpoints as lp (lp.index)}
			{#if isAdmin}
				<Dialog.Root>
					<Dialog.Trigger class={TRIGGER_CLASS}>
						{@render body(lp)}
					</Dialog.Trigger>
					<Dialog.Content class="sm:max-w-md">
						<Dialog.Header>
							<Dialog.Title>{lp.title ?? m.evcc_card_title()}</Dialog.Title>
							{#if lp.vehicleTitle}
								<Dialog.Description>{lp.vehicleTitle}</Dialog.Description>
							{/if}
						</Dialog.Header>
						<EvQuickSettings {lp} />
					</Dialog.Content>
				</Dialog.Root>
			{:else}
				<div class={CARD_CLASS}>
					{@render body(lp)}
				</div>
			{/if}
		{/each}
	</div>
{/if}
