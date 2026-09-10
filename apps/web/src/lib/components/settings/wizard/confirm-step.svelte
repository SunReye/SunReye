<script lang="ts">
	import * as m from '$lib/paraglide/messages';
	import { connectionAddress } from '../devices/connection-draft';
	import type { ConnectionView } from '../devices/device-types';
	import type { RegisteredProfile } from '../profile-types';
	import type { CatalogEntryView, WizardAnswers } from './add-wizard';
	import { answerRows } from './confirm-rows';

	// STEP 4 — what is about to be created, in one list, before the request goes
	// out. The wizard puts three earlier answers behind a Back button; this is
	// the only screen that shows all of them at once.
	//
	// How step 3's answers are said differs per tier and lives in
	// `./confirm-rows.ts`: a device is a name, a role, a profile and an address,
	// not the form object it was collected in.
	let {
		entry,
		connection,
		answers,
		registered
	}: {
		/** Null only if step 2 were skipped, which `blockedAt` prevents. */
		entry: CatalogEntryView | null;
		connection: ConnectionView | null;
		answers: WizardAnswers;
		/** The installed profiles, so a device's profile is named rather than keyed. */
		registered: RegisteredProfile[];
	} = $props();

	const NOT_SET = '—';

	const endpoint = $derived(
		connection === null ? NOT_SET : `${connection.name} · ${connectionAddress(connection)}`
	);

	// One list, built in the script: the two answers the wizard always has, then
	// whatever step 3 asked for.
	const rows = $derived([
		{ key: 'connection', label: m.wizard_step_connection(), value: endpoint, mono: false },
		{ key: 'attach', label: m.wizard_step_attach(), value: entry?.label ?? NOT_SET, mono: false },
		...answerRows(answers, registered)
	]);
</script>

<dl class="flex flex-col gap-2 text-sm">
	{#each rows as row (row.key)}
		<div class="flex flex-wrap items-baseline gap-x-2">
			<dt class="text-muted-foreground">{row.label}</dt>
			<dd class={row.mono ? 'font-mono text-xs' : 'font-medium'}>{row.value}</dd>
		</div>
	{/each}
</dl>
