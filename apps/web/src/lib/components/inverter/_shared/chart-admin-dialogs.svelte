<script lang="ts">
	// The admin-only dialogs behind the custom-chart section: the create/edit editor,
	// and the delete confirmation — which owns the delete request itself, since
	// nothing outside this dialog needs its in-flight or error state.
	import * as Dialog from '$lib/components/ui/dialog';
	import { Button } from '$lib/components/ui/button';
	import * as m from '$lib/paraglide/messages';
	import CustomChartEditor from '$lib/components/inverter/custom-chart-editor.svelte';
	import { type CustomChart, customCharts } from '$lib/inverter/custom-charts.svelte';

	let {
		isAdmin,
		editorOpen = $bindable(false),
		editing,
		pendingDelete = $bindable(null)
	}: {
		isAdmin: boolean;
		editorOpen?: boolean;
		/** Chart being edited, or null to create a new one. */
		editing: CustomChart | null;
		/** Chart awaiting delete confirmation; null closes the dialog. */
		pendingDelete?: CustomChart | null;
	} = $props();

	let deleting = $state(false);
	let deleteError = $state<string | null>(null);

	const deleteName = $derived(pendingDelete?.name ?? '');
	const deleteLabel = $derived(deleting ? m.action_deleting() : m.action_delete());

	function onOpenChange(open: boolean) {
		if (!open) pendingDelete = null;
	}

	const cancel = () => (pendingDelete = null);

	async function confirmDelete() {
		if (!pendingDelete) return;
		deleting = true;
		deleteError = null;
		const err = await customCharts.remove(pendingDelete.id);
		deleting = false;
		if (err) {
			deleteError = err;
			return;
		}
		pendingDelete = null;
	}
</script>

{#if isAdmin}
	<CustomChartEditor bind:open={editorOpen} chart={editing} />

	<Dialog.Root open={pendingDelete !== null} {onOpenChange}>
		<Dialog.Content class="sm:max-w-sm">
			<Dialog.Header>
				<Dialog.Title>{m.chart_delete_chart()}</Dialog.Title>
				<Dialog.Description>
					{m.chart_delete_confirm({ name: deleteName })}
				</Dialog.Description>
			</Dialog.Header>
			{#if deleteError}
				<p class="text-sm text-destructive">{deleteError}</p>
			{/if}
			<Dialog.Footer>
				<Button variant="outline" onclick={cancel}>{m.action_cancel()}</Button>
				<Button variant="destructive" disabled={deleting} onclick={confirmDelete}>
					{deleteLabel}
				</Button>
			</Dialog.Footer>
		</Dialog.Content>
	</Dialog.Root>
{/if}
