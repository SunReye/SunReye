<script lang="ts">
	import { Button } from "$lib/components/ui/button";
	import { Switch } from "$lib/components/ui/switch";
	import type { Source } from "./profile-types";
	import * as m from "$lib/paraglide/messages";

	// One git source in the sources list: enable toggle plus removal, except for
	// the official source, which can be disabled but not removed.
	let {
		source,
		saving,
		onRemove,
		onToggle
	}: {
		source: Source;
		saving: boolean;
		onRemove: (url: string) => void;
		onToggle: (url: string, enabled: boolean) => void;
	} = $props();

	const title = $derived(source.label ?? source.url);
</script>

<div class="flex items-center justify-between gap-4 py-2.5">
	<div class="flex min-w-0 flex-col">
		<span class="truncate text-sm">{title}</span>
		{#if source.label}
			<span class="truncate text-xs text-muted-foreground">{source.url}</span>
		{/if}
	</div>
	<div class="flex shrink-0 items-center gap-3">
		<Switch
			checked={source.enabled}
			disabled={saving}
			onCheckedChange={(checked) => onToggle(source.url, checked)}
			aria-label={m.label_enabled()}
		/>
		{#if source.official}
			<!-- Protected: the official source can be disabled but not removed. -->
			<span class="text-xs uppercase tracking-wide text-muted-foreground">{m.sources_default()}</span>
		{:else}
			<Button variant="ghost" size="sm" disabled={saving} onclick={() => onRemove(source.url)}>
				{m.action_remove()}
			</Button>
		{/if}
	</div>
</div>
