<script lang="ts">
	import { Label } from '$lib/components/ui/label';
	import * as NativeSelect from '$lib/components/ui/native-select';
	import * as m from '$lib/paraglide/messages';
	import type { ConnectionDraft } from '../devices/connection-draft';
	import ConnectionProbe from '../devices/connection-probe.svelte';
	import { NEW_CONNECTION, type ConnectionView } from '../devices/device-types';
	import NewConnectionFields from '../devices/new-connection-fields.svelte';
	import { type WizardConnection, connectionChoice } from './add-wizard';
	import ConnectionGroup from './connection-group.svelte';

	// STEP 1 — which endpoint. Every kind is offered, grouped by kind, which is
	// the change that makes this a wizard rather than the old dialog: that one
	// listed Modbus gateways only, because a Modbus device was the only thing it
	// could add.
	//
	// The last option is not a row: an operator with no endpoint yet makes their
	// first one HERE, in the same question, from the same form the connection
	// dialog uses (`../devices/new-connection-fields.svelte`) and with the same
	// probe. Nothing about it is restated. The row itself is not written until
	// the wizard is FINISHED — see `submitPlan` in `./add-wizard.ts`.
	let {
		connections,
		chosen = $bindable(null),
		draft = $bindable()
	}: {
		connections: readonly ConnectionView[];
		chosen: WizardConnection | null;
		/** The endpoint being created, while the create option is the answer. */
		draft: ConnectionDraft;
	} = $props();

	const KIND_LABEL: Record<string, () => string> = {
		modbus: m.devices_kind_modbus,
		mqtt: m.devices_kind_mqtt
	};

	const groups = $derived(
		[...new Set(connections.map((c) => c.kind))].map((kind) => ({
			kind,
			label: KIND_LABEL[kind]?.() ?? kind,
			rows: connections.filter((c) => c.kind === kind)
		}))
	);

	/** The select's value for the current answer — a row's id, or the sentinel. */
	function optionValue(answer: WizardConnection | null): string {
		if (answer === null) return '';
		return answer.mode === 'create' ? NEW_CONNECTION : String(answer.id);
	}

	const value = $derived(optionValue(chosen));
	const creating = $derived(chosen?.mode === 'create');

	// The create arm carries a kind because the CATALOG is keyed by it; the draft
	// carries one because it decides which fields the form shows. One control
	// writes the draft's, so this keeps the wizard's copy on it.
	$effect(() => {
		const kind = draft.kind;
		if (chosen?.mode === 'create' && chosen.kind !== kind) chosen = { mode: 'create', kind };
	});
</script>

<div class="flex flex-col gap-4">
	<div class="flex flex-col gap-1.5">
		<Label for="wizard-connection">{m.wizard_step_connection()}</Label>
		<NativeSelect.Root
			id="wizard-connection"
			{value}
			onchange={(e) => (chosen = connectionChoice(e.currentTarget.value, draft.kind))}
		>
			<NativeSelect.Option value="">{m.wizard_connection_placeholder()}</NativeSelect.Option>
			{#each groups as group (group.kind)}
				<ConnectionGroup label={group.label} rows={group.rows} />
			{/each}
			<NativeSelect.Option value={NEW_CONNECTION}>{m.wizard_connection_new()}</NativeSelect.Option>
		</NativeSelect.Root>
		<p class="text-xs text-muted-foreground">{m.wizard_connection_hint()}</p>
	</div>

	{#if creating}
		<NewConnectionFields bind:connection={draft} kind="choose" />
		<ConnectionProbe {draft} />
	{/if}
</div>
