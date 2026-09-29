<script lang="ts">
	import '../app.css';
	import { ModeWatcher } from 'mode-watcher';
	import { Toaster } from '$lib/components/ui/sonner';
	import CanvasStyleHost from '$lib/components/ui/chart/canvas-style-host.svelte';

	const { children } = $props();
</script>

<ModeWatcher defaultMode="dark" />
<Toaster />
<CanvasStyleHost />

{@render children()}
