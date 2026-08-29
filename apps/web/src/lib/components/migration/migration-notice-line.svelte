<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import { display } from '$lib/display.svelte';
	import * as m from '$lib/paraglide/messages';

	/**
	 * The migration half of the notice: what is missing, and the two ways out.
	 *
	 * The DATE, never "some history is missing". A sentence an operator cannot act on
	 * is one they stop reading after a week, and the whole reason this line exists is
	 * that a deferred migration which leaves the app looking complete never gets run.
	 *
	 * `serverText` is the fallback the server itself composed. It is used only when
	 * `historyFrom` is absent — a withholding stage whose bookkeeping date failed to
	 * parse — because the server's sentence carries an ISO instant and the operator's
	 * own date format is better when there is one to format.
	 */
	let {
		historyFrom,
		serverText,
		running,
		canAct,
		busy,
		onMigrate,
		onSnooze
	}: {
		historyFrom: string | null;
		serverText: string | null;
		/** A backfill is in flight: say so instead of offering to start another. */
		running: boolean;
		/** Admin. A viewer who cannot fix it is still told. */
		canAct: boolean;
		busy: boolean;
		onMigrate: () => void;
		onSnooze: () => void;
	} = $props();

	// The sentence, decided in the script rather than as three template branches:
	// which of the three it is depends on facts, and a template is a bad place to
	// read a decision off.
	const text = $derived.by(() => {
		if (running) return m.migration_banner_migrating();
		if (historyFrom === null) return serverText ?? '';
		return m.migration_banner_history_missing({ date: display.day(new Date(historyFrom)) });
	});
	const showActions = $derived(canAct && !running);
</script>

<div class="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
	<span class="min-w-0">{text}</span>
	{#if showActions}
		<span class="flex shrink-0 gap-2 max-sm:w-full">
			<Button
				size="sm"
				variant="outline"
				class="h-9 flex-1 sm:h-8 sm:flex-none"
				disabled={busy}
				onclick={onMigrate}
			>
				{m.migration_banner_migrate_now()}
			</Button>
			<Button
				size="sm"
				variant="ghost"
				class="h-9 flex-1 sm:h-8 sm:flex-none"
				disabled={busy}
				onclick={onSnooze}
			>
				{m.migration_banner_snooze()}
			</Button>
		</span>
	{/if}
</div>
