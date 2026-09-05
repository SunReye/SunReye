<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import * as Alert from '$lib/components/ui/alert';
	import { formatReading } from '$lib/live/plant';
	import { livePlant } from '$lib/live/plant.svelte';
	import {
		capMatchesRegister,
		registerCapKw,
		seedsFromRegister
	} from '$lib/settings/export-cap-register';
	import * as m from '$lib/paraglide/messages';

	/**
	 * The inverter's own feed-in ceiling, read off its register by the feed that
	 * owns it (`$lib/live/ownership.ts`), beside the plant's export-cap field.
	 * Shown so the operator can see when the plant's ceiling and the inverter's
	 * disagree, and copied into the field on request — never written back.
	 */
	let {
		maxOutput = $bindable(),
		disabled
	}: {
		/** Max grid feed-in, kW, as edit text (the field this copies into). */
		maxOutput: string;
		disabled: boolean;
	} = $props();

	$effect(() => livePlant.lease());
	const sellLimit = $derived(livePlant.read('setting.solar_sell.max_power'));
	const sellLimitKw = $derived(registerCapKw(sellLimit));
	const matchesRegister = $derived(capMatchesRegister(maxOutput, sellLimit));
	// Decided here, not in the markup: a chip that is disabled while the field
	// already says what the register holds, and a notice only while they differ.
	const useDisabled = $derived(disabled || matchesRegister === true);
	const differs = $derived(matchesRegister === false);
	const fmtKw = (w: number) => `${(w / 1000).toFixed(1)} kW`;
	const apply = (): void => {
		if (sellLimitKw !== null) maxOutput = sellLimitKw;
	};

	// A blank field starts as the inverter's own ceiling, once per mount. The
	// operator's value — typed or stored — always wins; see `seedsFromRegister`.
	let seeded = $state(false);
	$effect(() => {
		if (!seedsFromRegister({ field: maxOutput, registerKw: sellLimitKw, seeded })) return;
		seeded = true;
		apply();
	});
</script>

{#if sellLimitKw !== null}
	<div class="flex flex-wrap items-center gap-2">
		<span class="text-xs text-muted-foreground">
			{m.weather_export_cap_register()}
			{formatReading(sellLimit, fmtKw, m.live_reading_stale())}
		</span>
		<Button variant="outline" size="sm" disabled={useDisabled} onclick={apply}>
			{m.weather_export_cap_register_use()}
		</Button>
	</div>
	{#if differs}
		<Alert.Root>
			<Alert.Description>{m.weather_export_cap_register_differs()}</Alert.Description>
		</Alert.Root>
	{/if}
{/if}
