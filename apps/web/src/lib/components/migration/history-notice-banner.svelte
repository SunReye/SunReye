<script lang="ts">
	import { historyIncomplete } from '$lib/history-incomplete.svelte';
	import { migration } from '$lib/migration.svelte';
	import IncompleteRangeLines from './incomplete-range-lines.svelte';
	import MigrationNoticeLine from './migration-notice-line.svelte';

	/**
	 * THE APP-WIDE "THIS INSTANCE CANNOT ANSWER EVERY WINDOW" NOTICE.
	 *
	 * Two causes, one banner, on purpose. A deferred 1.2.0 migration leaves history
	 * before the cutover absent; a retention policy leaves history before its horizon
	 * absent (issue #154). To the operator reading a month-to-date figure these are
	 * the same fact — the number covers less than the period it names — and the same
	 * sentence answers both.
	 *
	 * It lives in the app shell rather than on a settings page because a
	 * settings-scoped notice is one nobody sees. Every screen that can render a
	 * partial figure renders this above it.
	 *
	 * The migration half is dismissible for a WEEK, not for good: the whole reason
	 * the banner exists is that a deferred migration which leaves the app looking
	 * complete never gets run.
	 */
	let { isAdmin = false }: { isAdmin?: boolean } = $props();

	const status = $derived(migration.status);

	// The migration line shows only while something is genuinely outstanding AND the
	// snooze has run out. `banner` is the server's own sentence, computed from the
	// same horizon a 422 reports, so the date here and the date in a refusal cannot
	// disagree.
	const showMigration = $derived(
		status !== null && status.backfillOutstanding && status.banner !== null && !status.bannerSnoozed
	);
	const missingFrom = $derived(status?.historyFrom ?? null);

	const ranges = $derived(historyIncomplete.notices);
	const anything = $derived(showMigration || ranges.length > 0);
	const running = $derived(status?.backfillRunning ?? false);
	const serverText = $derived(status?.banner ?? null);

	let busy = $state(false);

	async function migrateNow() {
		busy = true;
		await migration.runBackfill();
		busy = false;
	}
</script>

{#if anything}
	<!-- Amber, and framed with its own tone rather than `border-border`: this is a
	     warning strip, not a section card, and the section primitives own that
	     frame. Only a bottom border — it sits directly under the sticky header and
	     reads as part of the chrome. -->
	<div
		class="flex flex-col gap-2 border-b border-amber-500/50 bg-amber-500/10 px-4 py-3 text-sm text-amber-800 dark:text-amber-300"
		role="status"
	>
		{#if showMigration}
			<MigrationNoticeLine
				historyFrom={missingFrom}
				{serverText}
				{running}
				canAct={isAdmin}
				{busy}
				onMigrate={migrateNow}
				onSnooze={() => migration.snooze()}
			/>
		{/if}
		{#if ranges.length > 0}
			<IncompleteRangeLines {ranges} />
		{/if}
	</div>
{/if}
