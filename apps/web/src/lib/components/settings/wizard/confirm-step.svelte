<script lang="ts">
	import * as m from '$lib/paraglide/messages';
	import { connectionAddress } from '../devices/connection-draft';
	import type { ConnectionView } from '../devices/device-types';
	import type { CatalogEntryView } from './add-wizard';
	import { fieldLabel } from './field-label';

	// STEP 4 — what is about to be created, in one list, before the request goes
	// out. The wizard puts three earlier answers behind a Back button; this is
	// the only screen that shows all of them at once.
	let {
		entry,
		connection,
		values
	}: {
		/** Null only if step 2 were skipped, which `blockedAt` prevents. */
		entry: CatalogEntryView | null;
		connection: ConnectionView | null;
		values: Record<string, unknown>;
	} = $props();

	const NOT_SET = '—';

	const endpoint = $derived(
		connection === null ? NOT_SET : `${connection.name} · ${connectionAddress(connection)}`
	);

	// One list, built in the script: the two answers the wizard always has, then
	// whatever the entry's own settings step asked for.
	const rows = $derived([
		{ key: 'connection', label: m.wizard_step_connection(), value: endpoint, mono: false },
		{ key: 'attach', label: m.wizard_step_attach(), value: entry?.label ?? NOT_SET, mono: false },
		...Object.entries(values).map(([key, value]) => ({
			key,
			label: fieldLabel(key),
			value: String(value),
			mono: true
		}))
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
