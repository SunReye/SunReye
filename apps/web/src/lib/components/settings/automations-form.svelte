<script lang="ts">
	import { onMount } from 'svelte';
	import { toast } from 'svelte-sonner';
	import { Label } from '$lib/components/ui/label';
	import { Switch } from '$lib/components/ui/switch';
	import { Button } from '$lib/components/ui/button';
	import { Badge } from '$lib/components/ui/badge';
	import * as Dialog from '$lib/components/ui/dialog';
	import Section from '$lib/components/layout/section.svelte';
	import SaveBar from './save-bar.svelte';
	import { apiErrorText } from '$lib/api-error';
	import { api } from '$lib/api';
	import { useAppSession } from '$lib/session';
	import { automationsGate } from '$lib/automations-gate.svelte';
	import * as m from '$lib/paraglide/messages';
	import type { AutomationConfig } from '$lib/automations';

	const session = useAppSession();
	const isAdmin = $derived($session.data?.user.role === 'admin');

	let draft = $state<AutomationConfig | null>(null);
	let saving = $state(false);
	let disclaimerOpen = $state(false);

	onMount(async () => {
		const { data } = await api.api.settings.automations.get();
		if (data) {
			draft = data as AutomationConfig;
			automationsGate.adopt(draft.enabled);
		}
	});

	// The master gate arms register writes, so the first enable runs through an
	// explicit disclaimer. Acceptance is persisted (timestamp) — later toggles
	// flip directly.
	function onMasterToggle(next: boolean) {
		if (!draft) return;
		if (next && !draft.disclaimerAcceptedAt) {
			disclaimerOpen = true;
			return;
		}
		draft.enabled = next;
	}

	function acceptDisclaimer() {
		if (!draft) return;
		draft.disclaimerAcceptedAt = new Date().toISOString();
		draft.enabled = true;
		disclaimerOpen = false;
	}

	async function save() {
		if (!draft) return;
		saving = true;
		const { data, error } = await api.api.settings.automations.put(draft);
		saving = false;
		if (error) {
			toast.error(apiErrorText(error.value, m.automations_toast_error()));
		} else {
			draft = data as AutomationConfig;
			// The sidebar hides Automations until the master gate is on, so the
			// save that turns it on has to tell the nav — otherwise enabling the
			// feature appears to do nothing until a reload.
			automationsGate.adopt(draft.enabled);
			toast.success(m.automations_toast_saved());
		}
	}
</script>

<SaveBar {isAdmin} {saving} disabled={!draft} onsave={save} />

{#snippet experimental()}
	<Badge variant="outline">{m.badge_experimental()}</Badge>
{/snippet}

<Section title={m.settings_tab_automations()} actions={experimental}>
	{#if !draft}
		<p class="text-sm text-muted-foreground">{m.app_loading()}</p>
	{:else}
		<p class="text-sm text-muted-foreground">{m.automations_master_desc()}</p>
		<!-- Said here rather than only on the Automations page: this switch is the
		     one place the feature is turned on, so it is the one place the warning
		     is guaranteed to be read. -->
		<p class="text-sm text-muted-foreground">{m.automations_experimental_note()}</p>

		<div class="flex items-center justify-between gap-4">
			<Label for="automations-enabled">{m.automations_master_enable()}</Label>
			<Switch
				id="automations-enabled"
				checked={draft.enabled}
				disabled={!isAdmin || saving}
				onCheckedChange={onMasterToggle}
			/>
		</div>

		<p class="text-sm text-muted-foreground">{m.automations_disclaimer_body()}</p>
		{#if draft.disclaimerAcceptedAt}
			<p class="text-xs text-muted-foreground">
				{m.automations_disclaimer_accepted({
					date: new Date(draft.disclaimerAcceptedAt).toLocaleDateString()
				})}
			</p>
		{/if}
	{/if}
</Section>

<Dialog.Root bind:open={disclaimerOpen}>
	<Dialog.Content>
		<Dialog.Header>
			<Dialog.Title>{m.automations_disclaimer_title()}</Dialog.Title>
			<Dialog.Description>{m.automations_disclaimer_body()}</Dialog.Description>
		</Dialog.Header>
		<Dialog.Footer>
			<Button variant="outline" onclick={() => (disclaimerOpen = false)}>
				{m.action_cancel()}
			</Button>
			<Button onclick={acceptDisclaimer}>{m.automations_disclaimer_accept()}</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
