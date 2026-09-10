<script lang="ts">
	import { page } from '$app/state';
	import IntegrationPanel from '$lib/components/settings/integrations/integration-panel.svelte';

	// One integration's own page, reached by clicking its row on Settings →
	// Devices. A settings panel like any other, so the settings layout owns the
	// shell and the header comes from the route table.
</script>

<IntegrationPanel id={page.params.id} />
