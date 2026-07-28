<script lang="ts">
	// Connection + cadence chip for the automations stream: a breathing dot while
	// the socket is live, and a countdown ring to the engine's next control
	// decision (fed by the streamed `tickMs` cadence and the last tick time).
	import LiveDot from './live-dot.svelte';
	import * as m from '$lib/paraglide/messages';

	let {
		connected,
		lastTickAt,
		tickMs
	}: { connected: boolean; lastTickAt: string | null; tickMs: number } = $props();

	// Coarse wall clock (4 Hz): smooth enough for a seconds countdown without
	// paying for an animation-frame loop.
	let nowMs = $state(Date.now());
	$effect(() => {
		const id = setInterval(() => (nowMs = Date.now()), 250);
		return () => clearInterval(id);
	});

	const sinceMs = $derived(lastTickAt === null ? null : nowMs - Date.parse(lastTickAt));
	// The next tick is due `tickMs` after the last one; clamped at 0 while a slow
	// tick (or the save hot-apply) runs long.
	const remainingS = $derived(
		sinceMs === null ? null : Math.max(0, Math.ceil((tickMs - sinceMs) / 1000))
	);
	const progress = $derived(sinceMs === null ? 0 : Math.min(1, Math.max(0, sinceMs / tickMs)));

	// Countdown ring geometry (16px viewBox).
	const R = 6;
	const CIRC = 2 * Math.PI * R;
</script>

<div class="flex items-center gap-4 text-xs text-muted-foreground">
	{#if connected && remainingS !== null}
		<span class="flex items-center gap-1.5 tabular-nums">
			<svg viewBox="0 0 16 16" class="size-3.5 -rotate-90" aria-hidden="true">
				<circle
					cx="8"
					cy="8"
					r={R}
					fill="none"
					stroke="currentColor"
					stroke-opacity="0.25"
					stroke-width="2"
				/>
				<circle
					cx="8"
					cy="8"
					r={R}
					fill="none"
					stroke="currentColor"
					stroke-width="2"
					stroke-dasharray={CIRC}
					stroke-dashoffset={CIRC * (1 - progress)}
					class="transition-[stroke-dashoffset] duration-300 ease-linear"
				/>
			</svg>
			{m.automations_next_decision({ seconds: remainingS })}
		</span>
	{/if}

	<LiveDot {connected} />
</div>
