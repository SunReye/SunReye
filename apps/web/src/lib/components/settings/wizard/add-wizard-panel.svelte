<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { toast } from 'svelte-sonner';
	import { api } from '$lib/api';
	import Section from '$lib/components/layout/section.svelte';
	import SetupStepper from '$lib/components/setup/setup-stepper.svelte';
	import * as m from '$lib/paraglide/messages';
	import { resolve } from '$lib/resolve';
	import { apiErrorText } from '../api-error';
	import type { ConnectionView, DeviceRoster } from '../devices/device-types';
	import {
		type Catalog,
		type ExistingIntegration,
		WIZARD_STEPS,
		advance,
		blockedAt,
		emptyWizard,
		entriesFor,
		goBack,
		submissionOf,
		wizardKind
	} from './add-wizard';
	import WizardBody from './wizard-body.svelte';
	import WizardNav from './wizard-nav.svelte';

	// The add wizard as a ROUTE rather than a dialog: four questions is more than
	// a modal holds at 400px, the browser's Back has to mean "the previous
	// screen", and the path is linkable from a support thread. The rules live in
	// `./add-wizard.ts` and the step bodies render themselves; this file owns the
	// two things neither can: what is loaded, and what is sent.
	let wizard = $state(emptyWizard());
	let connections = $state<ConnectionView[]>([]);
	let integrations = $state<ExistingIntegration[]>([]);
	let catalog = $state<Catalog>({ modbus: [], mqtt: [], internal: [] });
	let submitting = $state(false);

	const STEP_LABEL = {
		connection: m.wizard_step_connection,
		attach: m.wizard_step_attach,
		settings: m.wizard_step_settings,
		confirm: m.wizard_step_confirm
	};
	const steps = WIZARD_STEPS.map((key) => ({ key, label: STEP_LABEL[key]() }));

	/** The id of the chosen connection, or null while none is chosen. */
	const chosenId = $derived(wizard.connection?.mode === 'existing' ? wizard.connection.id : null);
	const kind = $derived(wizardKind(wizard, connections));
	const options = $derived(entriesFor(kind, catalog, integrations, chosenId ?? undefined));
	const entry = $derived(options.find((o) => o.entry.id === wizard.entryId)?.entry ?? null);
	const chosenConnection = $derived(connections.find((c) => c.id === chosenId) ?? null);
	const blocked = $derived(blockedAt(wizard, connections, catalog) !== null);
	const last = $derived(wizard.step === 'confirm');

	onMount(load);

	async function load() {
		const [roster, rows, shelf] = await Promise.all([
			api.api.devices.get(),
			api.api.integrations.get(),
			api.api.integrations.catalog.get()
		]);
		if (roster.data) connections = (roster.data as DeviceRoster).connections;
		if (rows.data) integrations = (rows.data as { integrations: ExistingIntegration[] }).integrations;
		if (shelf.data) catalog = shelf.data as Catalog;
	}

	function leave() {
		void goto(resolve('/settings/devices'));
	}

	function next() {
		if (last) return void submit();
		wizard = advance(wizard, connections, catalog);
	}

	async function submit() {
		const submission = submissionOf(wizard, connections, catalog);
		if (submission === null) return;
		submitting = true;
		const result = await send(submission);
		submitting = false;
		if (result === null) return leave();
		toast.error(result);
	}

	/** The request, and what it leaves behind: an error to show, or nothing. */
	async function send(
		submission: NonNullable<ReturnType<typeof submissionOf>>
	): Promise<string | null> {
		const answer =
			submission.target === 'integration'
				? await api.api.integrations.post(submission.body)
				: await api.api.devices.post(submission.body);
		if (answer.data) return added();
		return apiErrorText(answer.error?.value, m.error_unknown());
	}

	function added(): null {
		toast.success(m.wizard_added());
		return null;
	}
</script>

<Section title={m.wizard_title()} caption={m.wizard_caption()}>
	<div class="flex flex-col gap-6">
		<SetupStepper {steps} current={WIZARD_STEPS.indexOf(wizard.step)} />
		<WizardBody
			step={wizard.step}
			{connections}
			{options}
			{entry}
			{chosenConnection}
			bind:chosen={wizard.connection}
			bind:entryId={wizard.entryId}
			bind:values={wizard.values}
		/>
		<WizardNav
			first={wizard.step === 'connection'}
			{last}
			{blocked}
			busy={submitting}
			onCancel={leave}
			onBack={() => (wizard = goBack(wizard))}
			onNext={next}
		/>
	</div>
</Section>
