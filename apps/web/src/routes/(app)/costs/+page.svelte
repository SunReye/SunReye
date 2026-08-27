<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$lib/resolve';

	// The costs page moved to /statistics; this stub keeps old #/costs bookmarks
	// and links working. `replaceState` so Back does not bounce through the stub.
	onMount(() => {
		goto(resolve('/statistics'), { replaceState: true });
	});
</script>
