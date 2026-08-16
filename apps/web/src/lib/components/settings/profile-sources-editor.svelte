<script lang="ts">
	import { toast } from "svelte-sonner";
	import { Button } from "$lib/components/ui/button";
	import { Input } from "$lib/components/ui/input";
	import { Label } from "$lib/components/ui/label";
	import ProfileSourceRow from "./profile-source-row.svelte";
	import Section from '$lib/components/layout/section.svelte';
	import type { Source } from "./profile-types";
	import * as m from "$lib/paraglide/messages";

	let {
		sources,
		saving,
		onAdd,
		onRemove,
		onToggle
	}: {
		sources: Source[];
		saving: boolean;
		onAdd: (url: string) => void;
		onRemove: (url: string) => void;
		onToggle: (url: string, enabled: boolean) => void;
	} = $props();

	let newUrl = $state("");

	// Mirror the server's `gitUrlSchema` so invalid URLs are caught before we
	// optimistically add + auto-save them (the server would otherwise reject the
	// whole set with an opaque 400).
	function validationError(url: string): string | null {
		if (!url.startsWith("https://")) return m.sources_url_invalid();
		return null;
	}

	function add() {
		const url = newUrl.trim();
		if (!url) return;
		if (sources.some((s) => s.url === url)) {
			toast.error(m.sources_already_added());
			return;
		}
		const error = validationError(url);
		if (error) {
			toast.error(error);
			return;
		}
		onAdd(url);
		newUrl = "";
	}

	function onKeydown(e: KeyboardEvent) {
		if (e.key === "Enter") add();
	}
</script>

<Section title={m.sources_title()}>
	<div class="flex flex-col divide-y divide-border">
		{#each sources as s (s.url)}
			<ProfileSourceRow source={s} {saving} {onRemove} {onToggle} />
		{/each}
		{#if sources.length === 0}
			<p class="py-2.5 text-sm text-muted-foreground">{m.sources_none()}</p>
		{/if}
	</div>
	<div class="flex flex-col gap-2 sm:flex-row sm:items-end">
		<div class="flex min-w-0 flex-1 flex-col gap-1.5">
			<Label for="new-source">{m.sources_add_label()}</Label>
			<Input
				id="new-source"
				bind:value={newUrl}
				disabled={saving}
				placeholder="https://github.com/org/inverter-profiles.git"
				onkeydown={onKeydown}
			/>
		</div>
		<Button variant="outline" class="w-full sm:w-auto" disabled={saving} onclick={add}>{m.action_add()}</Button>
	</div>
</Section>
