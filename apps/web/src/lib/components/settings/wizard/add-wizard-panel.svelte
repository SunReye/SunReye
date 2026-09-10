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
	import {
		type ConnectionDraft,
		blankDraft,
		connectionCreateBody
	} from '../devices/connection-draft';
	import type { ConnectionView, DeviceRoster, DeviceView } from '../devices/device-types';
	import type { RegisteredProfile } from '../profile-types';
	import {
		type Catalog,
		type ExistingIntegration,
		type Submission,
		type SubmitPlan,
		WIZARD_STEPS,
		advance,
		blockedAt,
		emptyWizard,
		entriesFor,
		goBack,
		submissionOf,
		submitPlan,
		withSavedConnection,
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
	// The endpoint step 1 is creating, when it is creating one. Held here rather
	// than in the step body because THIS file is what sends it, and because a
	// step body is unmounted the moment the operator walks forward.
	let draft = $state<ConnectionDraft>(blankDraft());
	let connections = $state<ConnectionView[]>([]);
	// The roster and the installed profiles: what step 3 needs when the picked
	// entry is a DEVICE — which unit ids are taken on the chosen gateway, and
	// which register maps this install can speak.
	let devices = $state<DeviceView[]>([]);
	let registered = $state<RegisteredProfile[]>([]);
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
	/** The new endpoint's create body, or null while the form could not be sent. */
	const createBody = $derived(connectionCreateBody(draft));
	const blocked = $derived(blockedAt(wizard, connections, catalog, createBody !== null) !== null);
	const last = $derived(wizard.step === 'confirm');

	onMount(load);

	async function load() {
		const [roster, rows, shelf] = await Promise.all([
			api.api.devices.get(),
			api.api.integrations.get(),
			api.api.integrations.catalog.get(),
			loadRegistered()
		]);
		if (roster.data) {
			const loaded = roster.data as DeviceRoster;
			connections = loaded.connections;
			devices = loaded.devices;
		}
		if (rows.data) integrations = (rows.data as { integrations: ExistingIntegration[] }).integrations;
		if (shelf.data) catalog = shelf.data as Catalog;
	}

	async function loadRegistered() {
		const { data } = await api.api.profiles.get();
		if (data) registered = data as RegisteredProfile[];
	}

	/**
	 * A profile downloaded from inside step 3 lands in the picker above it, the
	 * way it does in the device dialog. Only the device arm has a form to point
	 * at one; the guard is the narrowing, not a defensive check.
	 */
	async function onInstalled(id: string) {
		await loadRegistered();
		if (wizard.answers.via === 'profile') wizard.answers.form.profileId = id;
	}

	function leave() {
		void goto(resolve('/settings/devices'));
	}

	function next() {
		if (last) return void submit();
		wizard = advance(wizard, connections, catalog, createBody !== null, { connections, devices });
	}

	async function submit() {
		const plan = submitPlan(wizard, connections, catalog);
		if (plan.do === 'nothing') return;
		submitting = true;
		const failure = await run(plan);
		submitting = false;
		if (failure === null) return leave();
		toast.error(failure);
	}

	/**
	 * THE ORDER THE TWO REQUESTS GO OUT IN, AND WHY.
	 *
	 * A connection the operator described in step 1 is created HERE, at finish —
	 * not when step 1 was left. A wizard abandoned at step 3 would otherwise
	 * leave an orphan endpoint row behind: nothing is attached to it, nothing
	 * polls it, and the operator who backed out has no reason to suspect it
	 * exists. So the endpoint is written first only once there is certainly
	 * something to hang off it, and the device or integration is posted second,
	 * against the id that came back.
	 */
	async function run(plan: Exclude<SubmitPlan, { do: 'nothing' }>): Promise<string | null> {
		if (plan.do === 'send') return await send(plan.submission, null);
		return await createConnection();
	}

	/** The FIRST request: the endpoint the operator described in step 1. */
	async function createConnection(): Promise<string | null> {
		if (createBody === null) return m.wizard_connection_incomplete();
		const answer = await api.api.connections.post(createBody);
		if (!answer.data) return apiErrorText(answer.error?.value, m.error_unknown());
		return await attachTo(answer.data as ConnectionView);
	}

	/**
	 * The endpoint exists now — so say so in the state before the second request,
	 * whatever that one does. A failure here is a HALF-SUCCESS, and re-creating
	 * the same connection on the next press is exactly the duplicate the operator
	 * would then have to find and delete by hand.
	 */
	async function attachTo(row: ConnectionView): Promise<string | null> {
		connections = [...connections, row];
		wizard = withSavedConnection(wizard, row.id);
		const submission = submissionOf(wizard, connections, catalog);
		if (submission === null) return m.wizard_half_saved({ name: row.name, error: m.error_unknown() });
		return await send(submission, row.name);
	}

	/** The request, and what it leaves behind: an error to show, or nothing. */
	async function send(submission: Submission, created: string | null): Promise<string | null> {
		const answer =
			submission.target === 'integration'
				? await api.api.integrations.post(submission.body)
				: await api.api.devices.post(submission.body);
		if (answer.data) return added();
		return refusal(apiErrorText(answer.error?.value, m.error_unknown()), created);
	}

	/**
	 * What the operator is told when the second request failed: plainly WHICH
	 * half happened. A bare "could not add" after a connection was written reads
	 * as "nothing was saved", and the next attempt makes a second endpoint.
	 */
	function refusal(error: string, created: string | null): string {
		return created === null ? error : m.wizard_half_saved({ name: created, error });
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
			bind:draft
			bind:entryId={wizard.entryId}
			bind:answers={wizard.answers}
			{devices}
			{registered}
			{onInstalled}
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
