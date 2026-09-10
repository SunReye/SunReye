<script lang="ts">
	import { onMount } from 'svelte';
	import { toast } from 'svelte-sonner';
	import { api } from '$lib/api';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Switch } from '$lib/components/ui/switch';
	import BrokerSelect from './broker-select.svelte';
	import EvccSettingsSection from './evcc-settings-section.svelte';
	import FormActions from './form-actions.svelte';
	import MqttStatusBadge from './mqtt-status-badge.svelte';
	import Section from '$lib/components/layout/section.svelte';
	import EmptyState from '$lib/components/layout/empty-state.svelte';
	import { SECTION_GAP } from '$lib/layout/tokens';
	import type { ConnectionView } from './devices/device-types';
	import {
		type EvccSettingsForm,
		type MqttSettingsForm,
		brokerIdOf,
		brokerOptions,
		evccConfigBody,
		evccFormFrom,
		mqttConfigBody,
		mqttFormFrom
	} from './mqtt-config-form';
	import type { EvccConfig, MqttConfig, MqttStatus } from './mqtt-types';
	import * as m from '$lib/paraglide/messages';

	// THE INTEGRATIONS PANEL: what this plant publishes outwards (Home Assistant
	// discovery) and what it reads inwards (EVCC). Neither card holds a broker
	// any more — since #217 both NAME a `kind = 'mqtt'` connection, added under
	// Devices, and they may name different ones.
	//
	// So there is no broker URL, no username and no password on this page, and
	// nothing to mask: the credential lives on the connection row and
	// `/api/connections` is what masks it.
	let { status = null }: { status?: MqttStatus | null } = $props();

	let cfg = $state<MqttSettingsForm | null>(null);
	let evccCfg = $state<EvccSettingsForm | null>(null);
	let connections = $state<ConnectionView[]>([]);
	let saving = $state(false);
	let testing = $state(false);
	let testResult = $state<{ ok: boolean; error?: string } | null>(null);

	const brokers = $derived(brokerOptions(connections));
	/** The export card's own broker value, empty while the config is still loading. */
	const chosenBroker = $derived(cfg?.brokerChoice ?? '');
	const body = $derived(cfg ? mqttConfigBody(cfg) : null);
	const evccBody = $derived(evccCfg ? evccConfigBody(evccCfg) : null);
	/** Both cards save with the one button, so either one being unsendable blocks it. */
	const blocked = $derived(!cfg || body === null || (evccCfg !== null && evccBody === null));

	const result = $derived(
		testResult
			? {
					ok: testResult.ok,
					message: testResult.ok
						? m.mqtt_test_ok()
						: m.conn_test_failed({ error: testResult.error ?? '' })
				}
			: null
	);

	onMount(async () => {
		const [{ data }, { data: evccData }, { data: roster }] = await Promise.all([
			api.api.settings.mqtt.get(),
			api.api.settings.evcc.get(),
			api.api.connections.get()
		]);
		if (data) cfg = mqttFormFrom(data as MqttConfig);
		if (evccData) evccCfg = evccFormFrom(evccData as EvccConfig);
		if (roster) connections = (roster as { connections: ConnectionView[] }).connections;
	});

	/** The treaty's failure as the test line reads it. */
	function refused(error: { value: unknown } | null) {
		return { ok: false, error: error ? String(error.value) : m.conn_request_failed() };
	}

	async function dial(connectionId: number) {
		testing = true;
		testResult = null;
		const { data, error } = await api.api.settings.mqtt.test.post({ connectionId });
		testing = false;
		testResult = data ?? refused(error);
	}

	/** Dial the broker the card NAMES — which may not be the one that is bound yet. */
	async function test() {
		const connectionId = brokerIdOf(chosenBroker);
		if (connectionId === null) {
			testResult = { ok: false, error: m.mqtt_broker_off() };
			return;
		}
		await dial(connectionId);
	}

	/** Saves the export config; false (with a toast) when the server refused. */
	async function saveExport(sending: MqttConfig): Promise<boolean> {
		const { error } = await api.api.settings.mqtt.put(sending);
		if (!error) return true;
		toast.error(m.mqtt_toast_error());
		return false;
	}

	/** EVCC saves with the same button — one panel, one save. */
	async function saveEvcc(): Promise<boolean> {
		if (!evccBody) return true;
		const { error } = await api.api.settings.evcc.put(evccBody);
		if (!error) return true;
		toast.error(m.evcc_toast_error());
		return false;
	}

	async function save() {
		const sending = body;
		if (!sending) return;
		saving = true;
		const ok = (await saveExport(sending)) && (await saveEvcc());
		saving = false;
		if (ok) toast.success(m.mqtt_toast_saved());
	}
</script>

<FormActions {result} {testing} {saving} disabled={blocked} ontest={test} onsave={save} />

{#if !cfg}
	<EmptyState message={m.app_loading()} />
{:else}
	<Section title={m.mqtt_ha_discovery()} caption={m.mqtt_ha_desc()}>
		{#snippet actions()}
			<MqttStatusBadge {status} />
		{/snippet}

		<div class="grid grid-cols-1 {SECTION_GAP} sm:grid-cols-2">
			<BrokerSelect id="mqtt-broker" bind:value={cfg.brokerChoice} options={brokers} />
			<div class="flex flex-col gap-1.5">
				<Label for="mqtt-prefix">{m.mqtt_topic_prefix()}</Label>
				<Input id="mqtt-prefix" bind:value={cfg.topicPrefix} />
			</div>
		</div>

		<div class="flex items-center justify-between gap-4 border-t border-border pt-4">
			<div class="flex flex-col">
				<Label for="mqtt-ha">{m.mqtt_ha_discovery()}</Label>
				<span class="text-xs text-muted-foreground">{m.mqtt_ha_desc()}</span>
			</div>
			<Switch id="mqtt-ha" bind:checked={cfg.haDiscoveryEnabled} />
		</div>
		{#if cfg.haDiscoveryEnabled}
			<div class="flex flex-col gap-1.5">
				<Label for="mqtt-ha-prefix">{m.mqtt_discovery_prefix()}</Label>
				<Input id="mqtt-ha-prefix" bind:value={cfg.haDiscoveryPrefix} class="max-w-60" />
			</div>
		{/if}
	</Section>

	{#if evccCfg}
		<EvccSettingsSection bind:cfg={evccCfg} {brokers} />
	{/if}
{/if}
