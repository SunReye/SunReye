<script lang="ts">
	import { onMount } from "svelte";
	import { toast } from "svelte-sonner";
	import { api } from "$lib/api";
	import { Button } from "$lib/components/ui/button";
	import FormActions from "./form-actions.svelte";
	import InverterConnectionFields from "./inverter-connection-fields.svelte";
	import InverterSimulateSwitch from "./inverter-simulate-switch.svelte";
	import InverterStatusBadge from "./inverter-status-badge.svelte";
	import Section from '$lib/components/layout/section.svelte';
	import EmptyState from '$lib/components/layout/empty-state.svelte';
	import SnapshotDialog from "./snapshot-dialog.svelte";
	import type { InverterConfig, InverterStatus, TestResult } from "./inverter-types";
	import * as m from "$lib/paraglide/messages";

	let {
		status = null,
		profileId = undefined
	}: {
		status?: InverterStatus | null;
		// When set (onboarding), test-reads run against this chosen profile instead
		// of the active one. Omitted on the settings page, where the server falls
		// back to the active profile.
		profileId?: string;
	} = $props();

	let cfg = $state<InverterConfig | null>(null);
	let saving = $state(false);
	let testing = $state(false);
	let snapshotOpen = $state(false);
	let testResult = $state<TestResult | null>(null);

	const result = $derived(
		testResult
			? {
					ok: testResult.ok,
					message: testResult.ok
						? m.inverter_test_ok({
								count: testResult.metricCount ?? 0,
								ms: testResult.durationMs ?? 0,
							})
						: m.conn_test_failed({ error: testResult.error ?? "" }),
				}
			: null,
	);

	const hasSnapshot = $derived((testResult?.metrics?.length ?? 0) > 0);
	const simulated = $derived(status?.simulate === true);

	onMount(async () => {
		const { data } = await api.api.settings.inverter.get();
		// host may be empty when the inverter isn't configured yet; keep it a
		// string so the bound Input stays controlled.
		if (data) cfg = { ...data, host: data.host ?? "" };
	});

	/** The draft plus, during onboarding, the profile to test-read against. */
	function testBody() {
		if (!cfg) return null;
		return profileId ? { ...cfg, profileId } : cfg;
	}

	async function runTest(body: InverterConfig & { profileId?: string }): Promise<TestResult> {
		const { data, error } = await api.api.settings.inverter.test.post(body);
		return data ?? { ok: false, error: error ? String(error.value) : m.conn_request_failed() };
	}

	async function test() {
		const body = testBody();
		if (!body) return;
		testing = true;
		testResult = null;
		const outcome = await runTest(body);
		testing = false;
		testResult = outcome;
		// On success, surface the captured snapshot for a plausibility check.
		if (outcome.ok && hasSnapshot) snapshotOpen = true;
	}

	/**
	 * Persist the connection. Exported (reachable via `bind:this`) so a caller
	 * that owns its own navigation — the setup wizard's Continue — can save
	 * before advancing instead of leaving a tested-but-unsaved config behind.
	 * Returns whether the write succeeded.
	 */
	/**
	 * Whether this draft is missing the one thing it cannot be saved without.
	 *
	 * A host is required only when something real is meant to be polled. While
	 * simulating there is nothing to dial, and demanding an address made the form
	 * unsaveable on exactly the box that needs it most: a fresh install with no
	 * inverter yet could not even turn the simulator off.
	 */
	const missingHost = $derived(cfg !== null && !cfg.simulate && !cfg.host.trim());

	export async function save(): Promise<boolean> {
		if (!cfg) return false;
		if (missingHost) {
			toast.error(m.inverter_toast_host_required());
			return false;
		}
		saving = true;
		const { error } = await api.api.settings.inverter.put(cfg);
		saving = false;
		if (error) {
			toast.error(m.inverter_toast_error());
			return false;
		}
		toast.success(m.inverter_toast_saved());
		return true;
	}
</script>

<FormActions
	{result}
	{testing}
	{saving}
	disabled={!cfg}
	testDisabled={cfg?.simulate === true}
	ontest={test}
	onsave={save}
>
	{#if hasSnapshot}
		<Button variant="ghost" size="sm" onclick={() => (snapshotOpen = true)}>
			{m.inverter_view_snapshot()}
		</Button>
	{/if}
</FormActions>

{#if !cfg}
	<EmptyState message={m.app_loading()} />
{:else}
	<Section title={m.inverter_connection()}>
		{#snippet actions()}
			<InverterStatusBadge {status} />
		{/snippet}

		<InverterSimulateSwitch bind:simulate={cfg.simulate} />

		<InverterConnectionFields bind:cfg {status} disabled={cfg.simulate} />
	</Section>

	<SnapshotDialog bind:open={snapshotOpen} result={testResult} />
{/if}
