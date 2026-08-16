<script lang="ts">
	import { onMount } from 'svelte';
	import { toast } from 'svelte-sonner';
	import { Switch } from '$lib/components/ui/switch';
	import { Label } from '$lib/components/ui/label';
	import Section from '$lib/components/layout/section.svelte';
	import { api } from '$lib/api';
	import { useAppSession } from '$lib/session';
	import * as m from '$lib/paraglide/messages';

	const session = useAppSession();
	const isAdmin = $derived($session.data?.user.role === 'admin');

	let publicDashboard = $state<boolean | null>(null);
	let saving = $state(false);

	onMount(async () => {
		const { data } = await api.api.settings.access.get();
		if (data) publicDashboard = data.publicDashboard;
	});

	async function toggle(next: boolean) {
		if (publicDashboard === null) return;
		const prev = publicDashboard;
		publicDashboard = next; // optimistic
		saving = true;
		const { error } = await api.api.settings.access.put({ publicDashboard: next });
		saving = false;
		if (error) {
			publicDashboard = prev; // revert on failure
			toast.error(m.access_toast_error());
		} else {
			toast.success(next ? m.access_toast_enabled() : m.access_toast_disabled());
		}
	}
</script>

<Section title={m.settings_tab_access()}>
	{#if publicDashboard === null}
		<p class="text-sm text-muted-foreground">{m.app_loading()}</p>
	{:else}
		<div class="flex items-start justify-between gap-4">
			<div class="flex flex-col gap-1">
				<Label for="public-dashboard">{m.access_public_label()}</Label>
				<p class="max-w-prose text-sm text-muted-foreground">
					{m.access_public_desc()}
				</p>
			</div>
			<Switch
				id="public-dashboard"
				checked={publicDashboard}
				disabled={!isAdmin || saving}
				onCheckedChange={toggle}
			/>
		</div>
		{#if !isAdmin}
			<span class="text-xs text-muted-foreground">{m.settings_admin_only()}</span>
		{/if}
	{/if}
</Section>
