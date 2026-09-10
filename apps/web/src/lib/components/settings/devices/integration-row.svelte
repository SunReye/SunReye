<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import { Switch } from '$lib/components/ui/switch';
	import * as m from '$lib/paraglide/messages';
	import { resolve } from '$lib/resolve';
	import StatusBadge from '../status-badge.svelte';
	import { integrationStatus } from '../integrations/integration-detail';
	import type { IntegrationView } from './device-types';

	// ONE integration's own line: what it is on the left, its controls on the
	// right. What it PROVIDES hangs below it, rendered by the parent — the
	// devices an integration yielded are not its siblings.
	//
	// The kind key (`evcc-ingest`, `ha-export`) used to be the subtitle here. It
	// is a slug: the label already says "EVCC" and "Home Assistant export", and a
	// database column read as an explanation of one. What replaces it is the one
	// thing the row could not previously answer — whether the thing is actually
	// CONNECTED, which is observed from the broker pool rather than derived from
	// the fact that a broker id is set.
	//
	// The name is a link, because an integration now has an inside: its live
	// status, its settings, and every device it provides, at
	// `/settings/integrations/:id`.
	let {
		integration,
		busy,
		onEdit,
		onToggle,
		onRemove
	}: {
		integration: IntegrationView;
		busy: boolean;
		onEdit: (integration: IntegrationView) => void;
		onToggle: (integration: IntegrationView, enabled: boolean) => void;
		onRemove: (integration: IntegrationView) => void;
	} = $props();

	const switchId = $derived(`integration-enabled-${integration.id}`);
	const status = $derived(integrationStatus(integration));
	const href = $derived(resolve(`/settings/integrations/${integration.id}`));
</script>

<div
	class="flex flex-col gap-3 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4"
	class:opacity-60={!integration.enabled}
	data-integration={integration.kind}
>
	<div class="flex min-w-0 flex-col gap-1">
		<span class="flex flex-wrap items-center gap-1.5 text-sm font-medium">
			<a class="wrap-break-word underline-offset-4 hover:underline" {href}>{integration.label}</a>
			<!-- Only the OFF state carries a pill. The switch to the right already
			     says "enabled", and saying it twice on one row put the loudest
			     colour on the case that needs no attention. -->
			{#if !integration.enabled}
				<StatusBadge ok={false} label={m.devices_integration_disabled()} />
			{/if}
		</span>
		<!-- The endpoint's state, when it is not the healthy one. A row that says
		     nothing about its connection is a row whose connection is fine. -->
		{#if !status.ok}
			<span class="text-xs text-muted-foreground">{status.label}</span>
		{/if}
	</div>
	<div class="flex shrink-0 flex-wrap items-center gap-2">
		<Switch
			id={switchId}
			checked={integration.enabled}
			disabled={busy}
			aria-label={integration.label}
			onCheckedChange={(v) => onToggle(integration, v === true)}
		/>
		<Button
			variant="outline"
			size="sm"
			class="flex-1 sm:flex-none"
			disabled={busy}
			onclick={() => onEdit(integration)}
		>
			{m.devices_action_edit()}
		</Button>
		<Button
			variant="ghost"
			size="sm"
			class="flex-1 sm:flex-none"
			disabled={busy}
			onclick={() => onRemove(integration)}
		>
			{m.devices_integration_action_remove()}
		</Button>
	</div>
</div>
