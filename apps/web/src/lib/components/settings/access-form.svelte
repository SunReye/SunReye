<script lang="ts">
	import { onMount } from 'svelte';
	import { toast } from 'svelte-sonner';
	import { Switch } from '$lib/components/ui/switch';
	import { Label } from '$lib/components/ui/label';
	import Section from '$lib/components/layout/section.svelte';
	import { kioskEnabled, setKiosk } from '$lib/kiosk';
	import { useAppSession } from '$lib/session';
	import * as m from '$lib/paraglide/messages';

	const session = useAppSession();
	const isAdmin = $derived($session.data?.user.admin === true);

	let kiosk = $state<boolean | null>(null);
	let saving = $state(false);

	onMount(async () => {
		kiosk = await kioskEnabled();
	});

	async function toggle(next: boolean) {
		if (kiosk === null) return;
		const prev = kiosk;
		kiosk = next; // optimistic
		saving = true;
		const saved = await setKiosk(next);
		saving = false;
		if (!saved) {
			kiosk = prev;
			toast.error(m.access_toast_error());
		} else {
			toast.success(next ? m.access_toast_enabled() : m.access_toast_disabled());
		}
	}
</script>

<Section title={m.settings_tab_access()}>
	{#if kiosk === null}
		<p class="text-sm text-muted-foreground">{m.app_loading()}</p>
	{:else}
		<div class="flex items-start justify-between gap-4">
			<div class="flex flex-col gap-1">
				<Label for="kiosk-view">{m.access_public_label()}</Label>
				<p class="max-w-prose text-sm text-muted-foreground">
					{m.access_public_desc()}
				</p>
			</div>
			<Switch
				id="kiosk-view"
				checked={kiosk}
				disabled={!isAdmin || saving}
				onCheckedChange={toggle}
			/>
		</div>
		{#if !isAdmin}
			<span class="text-xs text-muted-foreground">{m.settings_admin_only()}</span>
		{/if}
	{/if}
</Section>
