<script lang="ts">
	import type { ConnectionDraft } from '../devices/connection-draft';
	import type { ConnectionView } from '../devices/device-types';
	import type { AttachOption, CatalogEntryView, WizardConnection, WizardStep } from './add-wizard';
	import AttachStep from './attach-step.svelte';
	import ConfirmStep from './confirm-step.svelte';
	import ConnectionStep from './connection-step.svelte';
	import SettingsStep from './settings-step.svelte';

	// Which step body is on screen. Its own component so the panel holds the
	// requests and the navigation and this holds the four-way choice — together
	// they were one template with a branch per step on top of a branch per button.
	let {
		step,
		connections,
		options,
		entry,
		chosenConnection,
		chosen = $bindable(),
		draft = $bindable(),
		entryId = $bindable(),
		values = $bindable()
	}: {
		step: WizardStep;
		connections: readonly ConnectionView[];
		options: readonly AttachOption[];
		/** The picked catalog entry, or null before step 2 is answered. */
		entry: CatalogEntryView | null;
		chosenConnection: ConnectionView | null;
		chosen: WizardConnection | null;
		/** The endpoint step 1 is creating, while it is creating one. */
		draft: ConnectionDraft;
		entryId: string | null;
		values: Record<string, unknown>;
	} = $props();
</script>

{#if step === 'connection'}
	<ConnectionStep {connections} bind:chosen bind:draft />
{:else if step === 'attach'}
	<AttachStep {options} bind:entryId />
{:else if step === 'settings'}
	<SettingsStep {entry} bind:values />
{:else}
	<ConfirmStep {entry} connection={chosenConnection} {values} />
{/if}
