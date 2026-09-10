<script lang="ts">
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Switch } from '$lib/components/ui/switch';
	import Section from '$lib/components/layout/section.svelte';
	import { SECTION_GAP } from '$lib/layout/tokens';
	import BrokerSelect from './broker-select.svelte';
	import type { BrokerOption, EvccSettingsForm } from './mqtt-config-form';
	import * as m from '$lib/paraglide/messages';

	// The EVCC ingest, on its OWN broker connection (#217). It used to borrow the
	// Home Assistant export's broker, so the two could never be on different
	// brokers and every loadpoint device sat at `connection_id = null`.
	//
	// The loadpoints themselves are edited nowhere: they are coded devices, and
	// `PATCH /api/devices/:id` answers 409 for a non-Modbus one (#213). This card
	// is what their "Configure" link points at.
	let {
		cfg = $bindable(),
		brokers
	}: {
		cfg: EvccSettingsForm;
		brokers: BrokerOption[];
	} = $props();
</script>

<Section title={m.evcc_settings_title()}>
	<div class="flex items-center justify-between gap-4">
		<div class="flex flex-col">
			<Label for="evcc-enabled">{m.label_enabled()}</Label>
			<span class="text-xs text-muted-foreground">{m.evcc_enabled_desc()}</span>
		</div>
		<Switch id="evcc-enabled" bind:checked={cfg.enabled} />
	</div>
	{#if cfg.enabled}
		<div class="grid grid-cols-1 {SECTION_GAP} sm:grid-cols-2">
			<BrokerSelect id="evcc-broker" bind:value={cfg.brokerChoice} options={brokers} />
			<div class="flex flex-col gap-1.5">
				<Label for="evcc-topic">{m.evcc_topic_root()}</Label>
				<Input id="evcc-topic" bind:value={cfg.topicRoot} placeholder="evcc" />
				<span class="text-xs text-muted-foreground">{m.evcc_topic_hint()}</span>
			</div>
		</div>
		<div
			class="flex flex-wrap items-center justify-between {SECTION_GAP} border-t border-border pt-4"
		>
			<div class="flex flex-col">
				<Label for="evcc-subtract">{m.evcc_subtract_label()}</Label>
				<span class="text-xs text-muted-foreground">{m.evcc_subtract_hint()}</span>
			</div>
			<Switch id="evcc-subtract" bind:checked={cfg.subtractFromHome} />
		</div>
	{/if}
</Section>
