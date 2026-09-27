<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import { Switch } from '$lib/components/ui/switch';
	import * as m from '$lib/paraglide/messages';
	import { resolve } from '$lib/resolve';
	import StatusBadge from '../status-badge.svelte';
	import { integrationStatus } from '../integrations/integration-detail';
	import type { IntegrationHandlers, IntegrationView } from './device-types';
	import RowOverflowMenu from './row-overflow-menu.svelte';

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
		handlers
	}: {
		integration: IntegrationView;
		busy: boolean;
		handlers: IntegrationHandlers;
	} = $props();

	const switchId = $derived(`integration-enabled-${integration.id}`);
	const status = $derived(integrationStatus(integration));
	const href = $derived(resolve(`/settings/integrations/${integration.id}`));
	// Remove is the destructive one, so it sits behind the row's menu like a
	// device's Delete — never a bare button next to Edit, one mis-tap away.
	const menu = $derived([
		{
			id: 'remove',
			label: m.devices_integration_action_remove(),
			destructive: true,
			onSelect: () => handlers.remove(integration)
		}
	]);
</script>

<div
	class="flex items-center justify-between gap-3 py-3 sm:gap-4"
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
	<div class="flex shrink-0 items-center gap-1 sm:gap-2">
		<Switch
			id={switchId}
			checked={integration.enabled}
			disabled={busy}
			aria-label={integration.label}
			onCheckedChange={(v) => handlers.toggle(integration, v === true)}
		/>
		<Button
			variant="outline"
			size="sm"
			class="ml-1 h-9 sm:h-8"
			disabled={busy}
			onclick={() => handlers.edit(integration)}
		>
			{m.devices_action_edit()}
		</Button>
		<RowOverflowMenu
			label={m.devices_more_actions({ name: integration.label })}
			items={menu}
			disabled={busy}
		/>
	</div>
</div>
