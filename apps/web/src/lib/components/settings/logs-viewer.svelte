<script lang="ts">
	import PauseIcon from 'phosphor-svelte/lib/Pause';
	import PlayIcon from 'phosphor-svelte/lib/Play';
	import DownloadSimpleIcon from 'phosphor-svelte/lib/DownloadSimple';
	import TrashIcon from 'phosphor-svelte/lib/Trash';
	import { Button } from '$lib/components/ui/button';
	import { downloadText } from '$lib/utils';
	import { logs, type LogEntry } from '$lib/logs/store.svelte';
	import SettingsSection from './settings-section.svelte';
	import * as m from '$lib/paraglide/messages';

	// Lease the shared log socket while this panel is mounted; the store opens the
	// WebSocket on the first lease and closes it when this disposer runs.
	$effect(() => logs.connect());

	// Auto-follow the tail unless the operator has scrolled up (or paused). We
	// re-check on every scroll so following resumes when they return to the bottom.
	let viewport = $state<HTMLDivElement | null>(null);
	let follow = $state(true);

	function onScroll(): void {
		if (!viewport) return;
		const { scrollTop, scrollHeight, clientHeight } = viewport;
		follow = scrollHeight - scrollTop - clientHeight < 40;
	}

	$effect(() => {
		// Reading the length registers the dependency so this runs on each new
		// line; scroll after the DOM has painted it.
		const lineCount = logs.lines.length;
		if (lineCount > 0 && follow && !logs.paused && viewport) {
			viewport.scrollTop = viewport.scrollHeight;
		}
	});

	const LEVEL_CLASS: Record<LogEntry['level'], string> = {
		trace: 'text-muted-foreground',
		debug: 'text-muted-foreground',
		info: 'text-foreground',
		warning: 'text-amber-500',
		error: 'text-red-500',
		fatal: 'text-red-500'
	};

	function fmtTime(ms: number): string {
		const d = new Date(ms);
		const p = (n: number, w = 2) => String(n).padStart(w, '0');
		return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
	}

	function exportLogs(): void {
		const text =
			logs.lines
				.map(
					(l) =>
						`${new Date(l.time).toISOString()} ${l.level.toUpperCase().padEnd(7)} ${l.category} ${l.message}`
				)
				.join('\n') + '\n';
		const stamp = new Date().toISOString().replace(/[:.]/g, '-');
		downloadText(`sunreye-logs-${stamp}.txt`, text);
	}
</script>

<SettingsSection title={m.logs_title()}>
	{#snippet actions()}
		<div class="flex items-center gap-2">
			<span class="flex items-center gap-1.5 text-xs text-muted-foreground">
				<span
					class="size-2 shrink-0 rounded-full {logs.paused
						? 'bg-amber-500'
						: logs.connected
							? 'animate-pulse bg-emerald-500'
							: 'bg-muted-foreground'}"
				></span>
				{logs.paused
					? m.logs_status_paused()
					: logs.connected
						? m.logs_status_live()
						: m.logs_status_offline()}
			</span>
			<Button variant="outline" size="sm" onclick={() => (logs.paused ? logs.resume() : logs.pause())}>
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
			<Button
				variant="outline"
				size="sm"
				onclick={exportLogs}
				disabled={logs.lines.length === 0}
			>
				<DownloadSimpleIcon class="size-4" />
				{m.logs_export()}
			</Button>
			<Button variant="outline" size="sm" onclick={() => logs.clear()} disabled={logs.lines.length === 0}>
				<TrashIcon class="size-4" />
				{m.logs_clear()}
			</Button>
		</div>
	{/snippet}

	<p class="text-sm text-muted-foreground">{m.logs_desc()}</p>

	<div
		bind:this={viewport}
		onscroll={onScroll}
		class="h-112 overflow-y-auto border border-border bg-muted/30 font-mono text-xs leading-relaxed"
	>
		{#if logs.lines.length === 0}
			<div class="flex h-full items-center justify-center text-muted-foreground">
				{m.logs_empty()}
			</div>
		{:else}
			{#each logs.lines as line, i (i)}
				<div class="flex gap-2 px-2 py-0.5 hover:bg-muted/50">
					<span class="shrink-0 text-muted-foreground">{fmtTime(line.time)}</span>
					<span class="w-14 shrink-0 uppercase {LEVEL_CLASS[line.level]}">{line.level}</span>
					<span class="shrink-0 text-muted-foreground">{line.category}</span>
					<span class="min-w-0 flex-1 whitespace-pre-wrap wrap-break-word {LEVEL_CLASS[line.level]}">
						{line.message}
					</span>
				</div>
			{/each}
		{/if}
	</div>
</SettingsSection>
