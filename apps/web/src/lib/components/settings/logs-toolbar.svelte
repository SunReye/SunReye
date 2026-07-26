<script lang="ts">
	import PauseIcon from 'phosphor-svelte/lib/Pause';
	import PlayIcon from 'phosphor-svelte/lib/Play';
	import DownloadSimpleIcon from 'phosphor-svelte/lib/DownloadSimple';
	import TrashIcon from 'phosphor-svelte/lib/Trash';
	import { Button } from '$lib/components/ui/button';
	import { logs } from '$lib/logs/store.svelte';
	import * as m from '$lib/paraglide/messages';

	// Header controls of the log panel: stream state, pause/resume (with the
	// buffered line count while paused), export and clear.
	let { exportDisabled, onexport }: { exportDisabled: boolean; onexport: () => void } = $props();

	const dotClass = $derived(
		logs.paused
			? 'bg-amber-500'
			: logs.connected
				? 'animate-pulse bg-emerald-500'
				: 'bg-muted-foreground'
	);
	const statusLabel = $derived(
		logs.paused
			? m.logs_status_paused()
			: logs.connected
				? m.logs_status_live()
				: m.logs_status_offline()
	);

	const togglePause = () => (logs.paused ? logs.resume() : logs.pause());
</script>

<div class="flex items-center gap-2">
	<span class="flex items-center gap-1.5 text-xs text-muted-foreground">
		<span class="size-2 shrink-0 rounded-full {dotClass}"></span>
		{statusLabel}
	</span>
	<Button variant="outline" size="sm" onclick={togglePause}>
		{#if logs.paused}
			<PlayIcon class="size-4" weight="fill" />
			{m.logs_resume()}
			{#if logs.pendingCount > 0}
				<span class="ml-1 tabular-nums">({logs.pendingCount})</span>
			{/if}
		{:else}
			<PauseIcon class="size-4" weight="fill" />
			{m.logs_pause()}
		{/if}
	</Button>
	<Button variant="outline" size="sm" onclick={onexport} disabled={exportDisabled}>
		<DownloadSimpleIcon class="size-4" />
		{m.logs_export()}
	</Button>
	<Button variant="outline" size="sm" onclick={() => logs.clear()} disabled={logs.lines.length === 0}>
		<TrashIcon class="size-4" />
		{m.logs_clear()}
	</Button>
</div>
