<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import { Switch } from '$lib/components/ui/switch';
	import * as m from '$lib/paraglide/messages';
	import StatusBadge from '../status-badge.svelte';
	import type { IntegrationView } from './device-types';

	// ONE integration of its connection's card: what it is on the left, its three
	// controls on the right. A row's PRESENCE is its configuration — there is no
	// "not configured" placeholder to render — so the state this shows is only
	// whether it is currently running.
	//
	// The switch writes immediately (a `PATCH { enabled }`); Edit and Remove open
	// the parent's dialogs, because one asks for settings and the other asks
	// first. Nothing decides anything here: the parent owns every request.
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
</script>

<div
	class="flex flex-col gap-3 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4"
	class:opacity-60={!integration.enabled}
	data-integration={integration.kind}
>
	<div class="flex min-w-0 flex-col gap-1">
		<span class="flex flex-wrap items-center gap-1.5 text-sm font-medium">
			<span class="wrap-break-word">{integration.label}</span>
			<StatusBadge
				ok={integration.enabled}
				label={integration.enabled ? m.label_enabled() : m.devices_integration_disabled()}
			/>
		</span>
		<span class="text-xs text-muted-foreground">{integration.kind}</span>
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
