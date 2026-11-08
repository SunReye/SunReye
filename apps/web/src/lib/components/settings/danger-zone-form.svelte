<script lang="ts">
	import { coreCapabilities } from '$lib/capabilities.svelte';
	import { Button } from '$lib/components/ui/button';
	import RestartButton from './restart-button.svelte';
	import WarningIcon from 'phosphor-svelte/lib/Warning';
	import DownloadIcon from 'phosphor-svelte/lib/DownloadSimple';
	import { serverUrl } from '$lib/server-url';
	import * as m from '$lib/paraglide/messages';

	let exporting = $state(false);

	/**
	 * The export is a NAVIGATION, not a fetch.
	 *
	 * `downloadText` in `$lib/utils` builds the whole payload as a string in the
	 * browser, which is right for a settings blob and impossible here: a full
	 * history export is ~9M readings and tens of megabytes. Following the URL lets
	 * the browser stream the response straight to disk, with the progress bar and
	 * the resume behaviour that come free with a real Content-Length.
	 *
	 * Built from `serverUrl` rather than written as an absolute path, so it stays
	 * under the Home Assistant ingress prefix; the session cookie rides along
	 * because it is a same-origin request.
	 */
	const exportHref = $derived(`${serverUrl}/api/admin/export`);

	/**
	 * Only the label is optimistic. The archive is built before the first byte is
	 * sent (a tar header must declare its member sizes), so on a full history there
	 * is a real minute of silence between the click and the download starting — and
	 * a button that looked idle through it would be clicked again.
	 *
	 * There is no completion event for a navigation-driven download, so the label
	 * is released on a timer rather than pretending to know. It is a hint, not a
	 * state machine.
	 */
	function startExport() {
		exporting = true;
		setTimeout(() => (exporting = false), 15_000);
	}
</script>

{#if coreCapabilities.has('dataReset')}
<section class="flex flex-col gap-4 border border-destructive/50 p-4">
	<div class="flex items-center gap-2 text-destructive">
		<WarningIcon class="size-4" weight="fill" />
		<h2 class="text-sm font-medium uppercase tracking-wide">{m.danger_zone_title()}</h2>
	</div>

	<div class="flex flex-col gap-1">
		<p class="text-sm font-medium">{m.settings_restart_server()}</p>
		<p class="text-sm text-muted-foreground">
			{m.danger_restart_desc()}
		</p>
	</div>

	<div>
		<RestartButton label={m.settings_restart_server()} variant="outline" />
	</div>

	<div class="border-t border-destructive/30"></div>

	<div class="flex flex-col gap-1">
		<p class="text-sm font-medium">{m.danger_export_title()}</p>
		<p class="text-sm text-muted-foreground">
			{m.danger_export_desc()}
		</p>
		<p class="text-xs text-muted-foreground">
			{m.danger_export_hint()}
		</p>
	</div>

	<div>
		<!-- An anchor, not a Button with onclick: the browser must follow it as a
		     navigation for the response to stream to disk. `download` asks it to save
		     rather than render, and the server's Content-Disposition names the file. -->
		<Button
			href={exportHref}
			download
			variant="outline"
			class="h-9 sm:h-8"
			onclick={startExport}
		>
			<DownloadIcon class="size-4" />
			{exporting ? m.danger_export_preparing() : m.danger_export_button()}
		</Button>
	</div>
</section>
{/if}
