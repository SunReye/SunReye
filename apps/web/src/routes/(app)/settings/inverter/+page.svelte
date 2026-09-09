<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$lib/resolve';

	// The pre-2.0 inverter panel. Its connection fields live in Settings → Devices
	// (a gateway is one of several) and its plant facts in Settings → Plant; the
	// path stays so bookmarks and the wizard's link land somewhere.
	$effect(() => {
		goto(resolve('/settings/devices'), { replaceState: true });
	});
</script>
