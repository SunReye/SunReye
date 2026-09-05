<script lang="ts">
	import { toast } from 'svelte-sonner';
	import { api } from '$lib/api';
	import { Button } from '$lib/components/ui/button';
	import * as Dialog from '$lib/components/ui/dialog';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import RestartButton from './restart-button.svelte';
	import { apiErrorText } from './api-error';
	import WarningIcon from 'phosphor-svelte/lib/Warning';
	import * as m from '$lib/paraglide/messages';

	// Must match RESET_DATA_CONFIRM on the server (apps/server/src/admin/maintenance.ts):
	// the user types it to arm the wipe, and the server re-checks it.
	const CONFIRM_PHRASE = 'DELETE ALL DATA';

	let open = $state(false);
	let phrase = $state('');
	let busy = $state(false);

	const armed = $derived(phrase.trim() === CONFIRM_PHRASE);

	async function reset() {
		if (!armed) return;
		busy = true;
		const { error } = await api.api.admin['reset-data'].post({ confirm: phrase.trim() });
		busy = false;
		if (error) {
			toast.error(apiErrorText(error.value, m.danger_toast_reset_error()));
			return;
		}
		toast.success(m.danger_toast_reset_success());
		open = false;
		phrase = '';
	}
</script>

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
		<p class="text-sm font-medium">{m.danger_reset_title()}</p>
		<p class="text-sm text-muted-foreground">
			{m.danger_reset_desc()}
		</p>
	</div>

	<div>
		<Button variant="destructive" onclick={() => (open = true)}>{m.danger_reset_button()}</Button>
	</div>
</section>

<Dialog.Root
	bind:open
	onOpenChange={(o) => {
		if (!o) phrase = '';
	}}
>
	<Dialog.Content>
		<Dialog.Header>
			<Dialog.Title>{m.danger_reset_dialog_title()}</Dialog.Title>
			<Dialog.Description>
				{m.danger_reset_confirm_pre()}
				<span class="font-mono font-medium text-foreground">{CONFIRM_PHRASE}</span>
				{m.danger_reset_confirm_post()}
			</Dialog.Description>
		</Dialog.Header>
		<div class="flex flex-col gap-1.5">
			<Label for="reset-confirm">{m.danger_confirm_label()}</Label>
			<Input
				id="reset-confirm"
				bind:value={phrase}
				autocomplete="off"
				placeholder={CONFIRM_PHRASE}
			/>
		</div>
		<Dialog.Footer>
			<Button variant="outline" onclick={() => (open = false)} disabled={busy}>{m.action_cancel()}</Button>
			<Button variant="destructive" onclick={reset} disabled={!armed || busy}>
				{busy ? m.danger_resetting() : m.danger_delete_everything()}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
