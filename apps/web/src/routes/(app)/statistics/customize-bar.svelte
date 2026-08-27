<script lang="ts">
	import { toast } from 'svelte-sonner';
	import { Button } from '$lib/components/ui/button';
	import ActionBar from '$lib/components/settings/action-bar.svelte';
	import * as m from '$lib/paraglide/messages';
	import { getCustomizeSession } from '$lib/statistics/customize.svelte';

	// Sticky save bar for customize mode, in the shared settings ActionBar so it
	// looks and sticks exactly like the preference forms. Draft-and-save:
	// nothing reaches the server until Save, and Cancel drops the draft.
	const customize = getCustomizeSession();
	const saveLabel = $derived(customize.saving ? m.action_saving() : m.action_save());

	async function save() {
		if (await customize.save()) toast.success(m.toast_statistics_saved());
		else toast.error(m.toast_statistics_error());
	}
</script>

<ActionBar>
	{#snippet info()}
		<span class="text-xs text-muted-foreground">{m.statistics_customize_hint()}</span>
	{/snippet}
	<Button variant="ghost" onclick={() => customize.cancel()} disabled={customize.saving}>
		{m.action_cancel()}
	</Button>
	<Button onclick={save} disabled={customize.saving}>{saveLabel}</Button>
</ActionBar>
