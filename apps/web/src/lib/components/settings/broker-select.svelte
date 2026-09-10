<script lang="ts">
	import { Label } from '$lib/components/ui/label';
	import * as NativeSelect from '$lib/components/ui/native-select';
	import * as m from '$lib/paraglide/messages';
	import { NO_BROKER, type BrokerOption } from './mqtt-config-form';

	// WHICH BROKER a record publishes to or subscribes on — a select over the
	// plant's `kind = 'mqtt'` connections (#217), not a URL and a password typed
	// twice on this page. Two records name a broker (the Home Assistant export
	// and the EVCC ingest) and they may name DIFFERENT ones, which is the whole
	// reason the endpoint became a connection.
	//
	// The empty option is real: a null connection IS "off", so there is no
	// separate switch that could disagree with it.
	let {
		value = $bindable(),
		options,
		id,
		label = m.mqtt_broker_field()
	}: {
		value: string;
		options: BrokerOption[];
		id: string;
		label?: string;
	} = $props();
</script>

<div class="flex flex-col gap-1.5">
	<Label for={id}>{label}</Label>
	<NativeSelect.Root {id} class="w-full" bind:value>
		<NativeSelect.Option value={NO_BROKER}>{m.mqtt_broker_off()}</NativeSelect.Option>
		{#each options as option (option.value)}
			<NativeSelect.Option value={option.value}>{option.label}</NativeSelect.Option>
		{/each}
	</NativeSelect.Root>
	{#if options.length === 0}
		<span class="text-xs text-muted-foreground">{m.mqtt_broker_none()}</span>
	{/if}
</div>
