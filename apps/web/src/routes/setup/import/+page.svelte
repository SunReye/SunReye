<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$lib/resolve';
	import { confirmArchive, uploadArchive } from '$lib/archive-import/import-client';
	import ImportPanel from '$lib/components/import/import-panel.svelte';
	import SetupShell from '$lib/components/setup/setup-shell.svelte';
	import { useSetupGate } from '$lib/components/setup/use-setup-gate.svelte';
	import { Button } from '$lib/components/ui/button';
	import { core } from '$lib/core-api';
	import * as m from '$lib/paraglide/messages';

	// The import fills an empty core, so it sits beside the first-run wizard and is gated like it.
	useSetupGate(false);
</script>

<SetupShell title={m.import_title()} subtitle={m.import_subtitle()} step="profile">
	<ImportPanel
		upload={(file, onProgress) => uploadArchive(core, file, onProgress)}
		confirm={(sha256) => confirmArchive(core, sha256)}
		onDone={() => goto(resolve('/'))}
	/>
	<div>
		<Button variant="link" class="h-9 px-0 sm:h-8" href={resolve('/setup')}>{m.action_back()}</Button>
	</div>
</SetupShell>
