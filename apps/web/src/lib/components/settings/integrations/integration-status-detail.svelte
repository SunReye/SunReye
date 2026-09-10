<script lang="ts">
	import { dateTime } from '$lib/format/date';
	import * as m from '$lib/paraglide/messages';
	import type { IntegrationStatusView } from './integration-detail';

	// The two moments behind the badge: when the endpoint last opened, and when
	// it last failed.
	//
	// The error is the whole point of showing a status at all — a red pill with
	// nothing to act on tells an operator only that they have a problem — and it
	// survives a reconnect, because "it drops every ten minutes" is a fault whose
	// only evidence is a failure behind a currently-green socket.
	//
	// "Nothing has failed yet" is said only when the connection was OBSERVED.
	// Claiming a clean record for a socket this process never held would be a
	// measurement nobody made.
	let { status }: { status: IntegrationStatusView } = $props();

	const lastConnected = $derived(dateTime(status.lastConnectedAt));
	const lastErrorAt = $derived(dateTime(status.lastErrorAt) ?? '');
</script>

{#if lastConnected}
	<p class="text-xs text-muted-foreground">
		{m.integration_status_last_connected({ at: lastConnected })}
	</p>
{/if}

{#if status.lastError}
	<p class="text-xs wrap-break-word text-destructive" data-last-error>
		{m.integration_status_last_error({ at: lastErrorAt, error: status.lastError })}
	</p>
{:else if status.observed}
	<p class="text-xs text-muted-foreground">{m.integration_status_no_error()}</p>
{/if}
