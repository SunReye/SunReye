<script lang="ts">
	import { logs, type LogEntry } from '$lib/logs/store.svelte';
	import { LEVEL_CLASS } from './log-levels';
	import * as m from '$lib/paraglide/messages';

	// The scrolling log body. `total` is the unfiltered buffer size, so "nothing
	// received yet" and "nothing matches the filter" read differently.
	let { lines, total }: { lines: LogEntry[]; total: number } = $props();

	// Auto-follow the tail unless the operator has scrolled up (or paused). We
	// re-check on every scroll so following resumes when they return to the bottom.
	let viewport = $state<HTMLDivElement | null>(null);
	let follow = $state(true);

	function onScroll(): void {
		if (!viewport) return;
		const { scrollTop, scrollHeight, clientHeight } = viewport;
		follow = scrollHeight - scrollTop - clientHeight < 40;
	}

	const shouldFollow = (lineCount: number) => lineCount > 0 && follow && !logs.paused;

	$effect(() => {
		// Reading the length registers the dependency so this runs on each new
		// (visible) line; scroll after the DOM has painted it.
		if (shouldFollow(lines.length) && viewport) {
			viewport.scrollTop = viewport.scrollHeight;
		}
	});

	const message = $derived(
		total === 0 ? m.logs_empty() : lines.length === 0 ? m.logs_no_match() : null
	);

	function fmtTime(ms: number): string {
		const d = new Date(ms);
		const p = (n: number, w = 2) => String(n).padStart(w, '0');
		return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
	}
</script>

<div
	bind:this={viewport}
	onscroll={onScroll}
	class="h-112 overflow-y-auto border border-border bg-muted/30 font-mono text-xs leading-relaxed"
>
	{#if message !== null}
		<div class="flex h-full items-center justify-center text-muted-foreground">
			{message}
		</div>
	{:else}
		{#each lines as line, i (i)}
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
