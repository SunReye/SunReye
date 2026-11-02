<script lang="ts">
	import '../app.css';
	import { onMount } from 'svelte';
	import { ModeWatcher } from 'mode-watcher';
	import { coreCapabilities } from '$lib/capabilities.svelte';
	import { Toaster } from '$lib/components/ui/sonner';
	import CanvasStyleHost from '$lib/components/ui/chart/canvas-style-host.svelte';

	const { children } = $props();

	onMount(() => {
		void coreCapabilities.load();
	});
</script>

<ModeWatcher defaultMode="dark" />
<Toaster />
<CanvasStyleHost />

{@render children()}
