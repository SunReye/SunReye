<script lang="ts">
	import type { ApiKeyView as KeyRow } from '@SunReye/contracts/api-keys';
	import { onMount } from 'svelte';
	import { toast } from 'svelte-sonner';
	import { api } from '$lib/api';
	import { authClient } from '$lib/auth-client';
	import { Button } from '$lib/components/ui/button';
	import * as Dialog from '$lib/components/ui/dialog';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import * as Table from '$lib/components/ui/table';
	import { apiMessageText } from './api-error';
	import CreateRowForm from './create-row-form.svelte';
	import DataTable from './data-table.svelte';
	import OptionSelect from './option-select.svelte';
	import RowRemoveButton from './row-remove-button.svelte';
	import Section from '$lib/components/layout/section.svelte';
	import CopyIcon from 'phosphor-svelte/lib/Copy';
	import * as m from '$lib/paraglide/messages';

	type UserRow = { id: string; name: string; email: string };

	// Expiry presets → seconds (null = never expires).
	const EXPIRY: { value: string; label: string; seconds: number | null }[] = [
		{ value: 'never', label: m.apikeys_expiry_never(), seconds: null },
		{ value: '30d', label: m.apikeys_expiry_30d(), seconds: 30 * 86400 },
		{ value: '90d', label: m.apikeys_expiry_90d(), seconds: 90 * 86400 },
		{ value: '1y', label: m.apikeys_expiry_1y(), seconds: 365 * 86400 }
	];

	const COLUMNS = [
		{ label: m.auth_field_name() },
		{ label: m.apikeys_col_owner() },
		{ label: m.apikeys_col_key() },
		{ label: m.apikeys_col_created(), class: 'w-24' },
		{ label: m.apikeys_field_expires(), class: 'w-24' },
		{ label: '', class: 'w-12' }
	];

	let users = $state<UserRow[]>([]);
	let keys = $state<KeyRow[]>([]);
	let loading = $state(true);

	// Issue-key form.
	let ownerId = $state('');
	let name = $state('');
	let expiry = $state('never');
	let creating = $state(false);

	// List filter ('' = all users).
	let filterUserId = $state('');

	// One-time secret reveal.
	let createdKey = $state<string | null>(null);

	const userItems = $derived(users.map((u) => ({ value: u.id, label: u.email })));
	const filterItems = $derived([{ value: '', label: m.apikeys_all_users() }, ...userItems]);
	const createLabel = $derived(creating ? m.apikeys_creating() : m.apikeys_create());
	const secretOpen = $derived(createdKey !== null);
	const secretValue = $derived(createdKey ?? '');

	const fmtDate = (s: string | null) => (s ? new Date(s).toLocaleDateString() : '—');
	const keyName = (k: KeyRow) => k.name ?? '—';
	/** Only the non-secret head of the key is stored, so show it truncated. */
	const keyHead = (k: KeyRow) => `${k.start ?? k.prefix ?? ''}…`;
	const expirySeconds = (value: string) => EXPIRY.find((x) => x.value === value)?.seconds ?? null;

	async function loadUsers() {
		const { data, error } = await authClient.admin.listUsers({ query: { limit: 100 } });
		if (error) toast.error(m.users_toast_load_error());
		else users = (data?.users ?? []) as UserRow[];
	}

	async function loadKeys() {
		loading = true;
		const { data, error } = await api.api.admin['api-keys'].get({
			query: filterUserId ? { userId: filterUserId } : {}
		});
		if (error) toast.error(m.apikeys_toast_load_error());
		else keys = data ?? [];
		loading = false;
	}

	onMount(async () => {
		await Promise.all([loadUsers(), loadKeys()]);
	});

	function setFilter(value: string) {
		filterUserId = value;
		void loadKeys();
	}

	type Issued = { ok: true; key: string | null } | { ok: false };

	/** POSTs the new key; toasts and reports `ok: false` when the server refused. */
	async function issueKey(): Promise<Issued> {
		const { data, error } = await api.api.admin['api-keys'].post({
			userId: ownerId,
			name,
			expiresIn: expirySeconds(expiry)
		});
		if (error) {
			toast.error(apiMessageText(error.value, m.apikeys_toast_create_error()));
			return { ok: false };
		}
		return { ok: true, key: data?.key ?? null };
	}

	async function create(e: SubmitEvent) {
		e.preventDefault();
		if (!ownerId) {
			toast.error(m.apikeys_toast_pick_user());
			return;
		}
		creating = true;
		const issued = await issueKey();
		creating = false;
		if (!issued.ok) return;
		createdKey = issued.key;
		name = '';
		expiry = 'never';
		await loadKeys();
	}

	async function revoke(k: KeyRow) {
		if (!confirm(m.apikeys_revoke_confirm({ label: k.name ?? k.userEmail }))) return;
		const { error } = await api.api.admin['api-keys'].revoke.post({ id: k.id });
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
	gridClass="sm:grid-cols-[1fr_1fr_auto_auto]"
	submitLabel={createLabel}
	busy={creating}
	onsubmit={create}
>
	<div class="flex flex-col gap-1.5">
		<Label>{m.users_role_user()}</Label>
		<OptionSelect
			value={ownerId}
			items={userItems}
			onchange={(v) => (ownerId = v)}
			placeholder={m.apikeys_select_user()}
			triggerClass="w-full"
		/>
	</div>
	<div class="flex flex-col gap-1.5">
		<Label for="k-name">{m.auth_field_name()}</Label>
		<Input id="k-name" bind:value={name} placeholder={m.apikeys_name_placeholder()} required />
	</div>
	<div class="flex flex-col gap-1.5">
		<Label>{m.apikeys_field_expires()}</Label>
		<OptionSelect
			value={expiry}
			items={EXPIRY}
			onchange={(v) => (expiry = v)}
			placeholder={m.apikeys_expiry_never()}
			triggerClass="w-32"
		/>
	</div>
</CreateRowForm>

{#snippet keyCells(k: KeyRow)}
	<Table.Cell class="font-medium">{keyName(k)}</Table.Cell>
	<Table.Cell class="text-muted-foreground">{k.userEmail}</Table.Cell>
	<Table.Cell class="font-mono text-xs text-muted-foreground">
		{keyHead(k)}
	</Table.Cell>
	<Table.Cell class="text-muted-foreground">{fmtDate(k.createdAt)}</Table.Cell>
	<Table.Cell class="text-muted-foreground">{fmtDate(k.expiresAt)}</Table.Cell>
	<Table.Cell>
		<RowRemoveButton label={m.apikeys_revoke_aria()} onclick={() => revoke(k)} />
	</Table.Cell>
{/snippet}

<Section title={m.apikeys_list_title()}>
	{#snippet actions()}
		<OptionSelect
			value={filterUserId}
			items={filterItems}
			onchange={setFilter}
			placeholder={m.apikeys_all_users()}
			triggerClass="w-48"
		/>
	{/snippet}
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
