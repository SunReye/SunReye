<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$lib/resolve';

	// Settings has no landing screen of its own — the first panel is the
	// canonical entry point, so redirect there and keep it out of history.
	$effect(() => {
		goto(resolve('/settings/inverter'), { replaceState: true });
	});
</script>
