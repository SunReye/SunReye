<script lang="ts">
	import { onMount } from 'svelte';
	import { toast } from 'svelte-sonner';
	import { api } from '$lib/api';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Switch } from '$lib/components/ui/switch';
	import EvccSettingsSection from './evcc-settings-section.svelte';
	import FormActions from './form-actions.svelte';
	import MqttStatusBadge from './mqtt-status-badge.svelte';
	import SettingsSection from './settings-section.svelte';
	import type { EvccForm, MqttForm, MqttStatus } from './mqtt-types';
	import * as m from '$lib/paraglide/messages';

	let { status = null }: { status?: MqttStatus | null } = $props();

	let cfg = $state<MqttForm | null>(null);
	let evccCfg = $state<EvccForm | null>(null);
	let hasPassword = $state(false);
	let password = $state('');
	let saving = $state(false);
	let testing = $state(false);
	let testResult = $state<{ ok: boolean; error?: string } | null>(null);

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
		const [{ data }, { data: evccData }] = await Promise.all([
			api.api.settings.mqtt.get(),
			api.api.settings.evcc.get()
		]);
		if (data) {
			hasPassword = data.hasPassword;
			cfg = {
				enabled: data.enabled,
				brokerUrl: data.brokerUrl,
				username: data.username ?? '',
				topicPrefix: data.topicPrefix,
				haDiscoveryEnabled: data.haDiscoveryEnabled,
				haDiscoveryPrefix: data.haDiscoveryPrefix
			};
		}
		if (evccData)
			evccCfg = {
				enabled: evccData.enabled,
				topicRoot: evccData.topicRoot,
				subtractFromHome: evccData.subtractFromHome
			};
	});

	const passwordPlaceholder = $derived(hasPassword ? m.mqtt_password_unchanged() : '');

	// Only send username/password when non-empty (password absent = unchanged).
	function payload() {
		if (!cfg) return null;
		return {
			...cfg,
			username: cfg.username || undefined,
			...(password ? { password } : {})
		};
	}

	type MqttPayload = NonNullable<ReturnType<typeof payload>>;

	async function test() {
		const body = payload();
		if (!body) return;
		testing = true;
		testResult = null;
		const { data, error } = await api.api.settings.mqtt.test.post(body);
		testing = false;
		testResult = data ?? { ok: false, error: error ? String(error.value) : m.conn_request_failed() };
	}

	/** Saves the broker settings; false (with a toast) when the server refused. */
	async function saveBroker(body: MqttPayload): Promise<boolean> {
		const { data, error } = await api.api.settings.mqtt.put(body);
		if (error) {
			toast.error(m.mqtt_toast_error());
			return false;
		}
		if (data) hasPassword = data.hasPassword;
		password = '';
		return true;
	}

	/** EVCC config saves with the same button (it shares the broker above). */
	async function saveEvcc(): Promise<boolean> {
		if (!evccCfg) return true;
		const { error } = await api.api.settings.evcc.put(evccCfg);
		if (!error) return true;
		toast.error(m.evcc_toast_error());
		return false;
	}

	async function save() {
		const body = payload();
		if (!body) return;
		saving = true;
		const ok = (await saveBroker(body)) && (await saveEvcc());
		saving = false;
		if (ok) toast.success(m.mqtt_toast_saved());
	}
</script>

<FormActions {result} {testing} {saving} disabled={!cfg} ontest={test} onsave={save} />

{#if !cfg}
	<div class="flex h-40 items-center justify-center border border-border text-sm text-muted-foreground">
		{m.app_loading()}
	</div>
{:else}
	<SettingsSection title={m.mqtt_broker_title()}>
		{#snippet actions()}
			<MqttStatusBadge {status} />
		{/snippet}

		<div class="flex items-center justify-between gap-4">
			<div class="flex flex-col">
				<Label for="mqtt-enabled">{m.label_enabled()}</Label>
				<span class="text-xs text-muted-foreground">{m.mqtt_enabled_desc()}</span>
			</div>
			<Switch id="mqtt-enabled" bind:checked={cfg.enabled} />
		</div>

		<div class="grid gap-4 sm:grid-cols-2">
			<div class="flex flex-col gap-1.5">
				<Label for="broker">Broker URL</Label>
				<Input id="broker" bind:value={cfg.brokerUrl} placeholder="mqtt://host:1883" />
			</div>
			<div class="flex flex-col gap-1.5">
				<Label for="prefix">Topic prefix</Label>
				<Input id="prefix" bind:value={cfg.topicPrefix} />
			</div>
			<div class="flex flex-col gap-1.5">
				<Label for="mqtt-user">{m.mqtt_username()}</Label>
				<Input id="mqtt-user" bind:value={cfg.username} autocomplete="off" />
			</div>
			<div class="flex flex-col gap-1.5">
				<Label for="mqtt-pass">{m.auth_field_password()}</Label>
				<Input
					id="mqtt-pass"
					type="password"
					bind:value={password}
					autocomplete="new-password"
					placeholder={passwordPlaceholder}
				/>
			</div>
		</div>

		<div class="flex items-center justify-between gap-4 border-t border-border pt-4">
			<div class="flex flex-col">
				<Label for="ha">{m.mqtt_ha_discovery()}</Label>
				<span class="text-xs text-muted-foreground">{m.mqtt_ha_desc()}</span>
			</div>
			<Switch id="ha" bind:checked={cfg.haDiscoveryEnabled} />
		</div>
		{#if cfg.haDiscoveryEnabled}
			<div class="flex flex-col gap-1.5">
				<Label for="ha-prefix">Discovery prefix</Label>
				<Input id="ha-prefix" bind:value={cfg.haDiscoveryPrefix} class="max-w-60" />
			</div>
		{/if}
	</SettingsSection>

	{#if evccCfg}
		<EvccSettingsSection bind:cfg={evccCfg} />
	{/if}
{/if}
