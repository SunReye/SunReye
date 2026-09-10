<script lang="ts">
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import * as m from '$lib/paraglide/messages';
	import type { MqttDraft } from './connection-draft';

	// An MQTT broker's endpoint. The password is write-only, exactly as
	// `app_settings.mqtt`'s was: the API never returns one, so an empty box means
	// "leave the stored one alone" and `hasPassword` is what the placeholder says.
	let {
		params = $bindable(),
		hasPassword
	}: {
		params: MqttDraft;
		hasPassword: boolean;
	} = $props();

	const passwordPlaceholder = $derived(hasPassword ? m.mqtt_password_unchanged() : '');
</script>

<div class="flex flex-col gap-1.5 sm:col-span-2">
	<Label for="connection-broker">{m.devices_field_broker_url()}</Label>
	<Input
		id="connection-broker"
		bind:value={params.brokerUrl}
		autocomplete="off"
		placeholder="mqtt://host:1883"
	/>
</div>
<div class="flex flex-col gap-1.5">
	<Label for="connection-username">{m.mqtt_username()}</Label>
	<Input id="connection-username" bind:value={params.username} autocomplete="off" />
</div>
<div class="flex flex-col gap-1.5">
	<Label for="connection-password">{m.auth_field_password()}</Label>
	<Input
		id="connection-password"
		type="password"
		bind:value={params.password}
		autocomplete="new-password"
		placeholder={passwordPlaceholder}
	/>
</div>
<div class="flex flex-col gap-1.5 sm:col-span-2">
	<Label for="connection-client-id">{m.devices_field_client_id()}</Label>
	<Input id="connection-client-id" bind:value={params.clientId} autocomplete="off" />
	<span class="text-xs text-muted-foreground">{m.devices_client_id_hint()}</span>
</div>
