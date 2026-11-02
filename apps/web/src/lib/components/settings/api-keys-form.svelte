<script lang="ts">
	import { onMount } from 'svelte';
	import { toast } from 'svelte-sonner';
	import { apiErrorText } from '$lib/api-error';
	import { core } from '$lib/core-api';
	import type { components } from '$lib/core-api.gen';
	import { Button } from '$lib/components/ui/button';
	import * as Dialog from '$lib/components/ui/dialog';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import * as Table from '$lib/components/ui/table';
	import CreateRowForm from './create-row-form.svelte';
	import DataTable from './data-table.svelte';
	import OptionSelect from './option-select.svelte';
	import RowRemoveButton from './row-remove-button.svelte';
	import Section from '$lib/components/layout/section.svelte';
	import CopyIcon from 'phosphor-svelte/lib/Copy';
	import * as m from '$lib/paraglide/messages';

	type UserRow = components['schemas']['Account'];
	type KeyRow = components['schemas']['ApiKeyView'];

	const COLUMNS = [
		{ label: m.auth_field_name() },
		{ label: m.apikeys_col_owner() },
		{ label: m.apikeys_col_key() },
		{ label: m.apikeys_col_created(), class: 'w-24' },
		{ label: '', class: 'w-12' }
	];

	let users = $state<UserRow[]>([]);
	let keys = $state<KeyRow[]>([]);
	let loading = $state(true);

	// Issue-key form.
	let ownerId = $state<number | null>(null);
	let name = $state('');
	let creating = $state(false);

	// One-time secret reveal.
	let createdKey = $state<string | null>(null);

	const userItems = $derived(users.map((u) => ({ value: String(u.id), label: u.email })));
	const createLabel = $derived(creating ? m.apikeys_creating() : m.apikeys_create());
	const secretOpen = $derived(createdKey !== null);
	const secretValue = $derived(createdKey ?? '');

	const fmtDate = (s: string) => new Date(s).toLocaleDateString();
	/** Only the non-secret head of the key is stored, so show it truncated. */
	const keyHead = (k: KeyRow) => `${k.start}…`;

	async function loadUsers() {
		const { data, error } = await core.GET('/api/admin/users');
		if (error) toast.error(m.users_toast_load_error());
		else users = data ?? [];
	}

	async function loadKeys() {
		loading = true;
		const { data, error } = await core.GET('/api/admin/api-keys');
		if (error) toast.error(m.apikeys_toast_load_error());
		else keys = data ?? [];
		loading = false;
	}

	onMount(async () => {
		await Promise.all([loadUsers(), loadKeys()]);
	});

	type Issued = { ok: true; key: string } | { ok: false };

	/** POSTs the new key for `owner`; toasts and reports `ok: false` when the core refused. */
	async function issueKey(owner: number): Promise<Issued> {
		const { data, error } = await core.POST('/api/admin/api-keys', {
			body: { userId: owner, name }
		});
		if (!data) {
			toast.error(apiErrorText(error, m.apikeys_toast_create_error()));
			return { ok: false };
		}
		return { ok: true, key: data.key };
	}

	async function create(e: SubmitEvent) {
		e.preventDefault();
		if (ownerId === null) {
			toast.error(m.apikeys_toast_pick_user());
			return;
		}
		creating = true;
		const issued = await issueKey(ownerId);
		creating = false;
		if (!issued.ok) return;
		createdKey = issued.key;
		name = '';
		await loadKeys();
	}

	async function revoke(k: KeyRow) {
		if (!confirm(m.apikeys_revoke_confirm({ label: k.name }))) return;
		const { error } = await core.POST('/api/admin/api-keys/revoke', { body: { id: k.id } });
		if (error) toast.error(m.apikeys_toast_revoke_error());
		else {
			toast.success(m.apikeys_toast_revoked());
			await loadKeys();
		}
	}

	function closeSecret(open: boolean) {
		if (!open) createdKey = null;
	}

	async function copyKey() {
		if (!createdKey) return;
		await navigator.clipboard.writeText(createdKey);
		toast.success(m.apikeys_toast_copied());
	}
</script>

<CreateRowForm
	title={m.apikeys_issue_title()}
	gridClass="sm:grid-cols-[1fr_1fr_auto]"
	submitLabel={createLabel}
	busy={creating}
	onsubmit={create}
>
	<div class="flex flex-col gap-1.5">
		<Label>{m.users_role_user()}</Label>
		<OptionSelect
			value={ownerId === null ? '' : String(ownerId)}
			items={userItems}
			onchange={(v) => (ownerId = Number(v))}
			placeholder={m.apikeys_select_user()}
			triggerClass="w-full"
		/>
	</div>
	<div class="flex flex-col gap-1.5">
		<Label for="k-name">{m.auth_field_name()}</Label>
		<Input id="k-name" bind:value={name} placeholder={m.apikeys_name_placeholder()} required />
	</div>
</CreateRowForm>

{#snippet keyCells(k: KeyRow)}
	<Table.Cell class="font-medium">{k.name}</Table.Cell>
	<Table.Cell class="text-muted-foreground">{k.userEmail}</Table.Cell>
	<Table.Cell class="font-mono text-xs text-muted-foreground">
		{keyHead(k)}
	</Table.Cell>
	<Table.Cell class="text-muted-foreground">{fmtDate(k.createdAt)}</Table.Cell>
	<Table.Cell>
		<RowRemoveButton label={m.apikeys_revoke_aria()} onclick={() => revoke(k)} />
	</Table.Cell>
{/snippet}

<Section title={m.apikeys_list_title()}>
	<DataTable
		{loading}
		loadingLabel={m.apikeys_loading()}
		emptyLabel={m.apikeys_empty()}
		columns={COLUMNS}
		rows={keys}
		cells={keyCells}
	/>
</Section>

<Dialog.Root open={secretOpen} onOpenChange={closeSecret}>
	<Dialog.Content>
		<Dialog.Header>
			<Dialog.Title>{m.apikeys_dialog_title()}</Dialog.Title>
			<Dialog.Description>
				{m.apikeys_dialog_desc()}
			</Dialog.Description>
		</Dialog.Header>
		<div class="flex items-center gap-2">
			<Input readonly value={secretValue} class="font-mono text-xs" />
			<Button variant="outline" size="icon" onclick={copyKey} aria-label={m.apikeys_copy_aria()}>
				<CopyIcon class="size-4" />
			</Button>
		</div>
		<Dialog.Footer>
			<Button onclick={() => (createdKey = null)}>{m.apikeys_done()}</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
