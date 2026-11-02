<script lang="ts">
	import { onMount } from 'svelte';
	import { toast } from 'svelte-sonner';
	import { apiErrorText } from '$lib/api-error';
	import { core } from '$lib/core-api';
	import { passwordRefusal } from '$lib/password';
	import type { components } from '$lib/core-api.gen';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import * as Table from '$lib/components/ui/table';
	import CreateRowForm from './create-row-form.svelte';
	import DataTable from './data-table.svelte';
	import OptionSelect from './option-select.svelte';
	import RowRemoveButton from './row-remove-button.svelte';
	import Section from '$lib/components/layout/section.svelte';
	import * as m from '$lib/paraglide/messages';

	type Role = 'user' | 'admin';
	type Row = components['schemas']['Account'];

	const ROLES: { value: Role; label: string }[] = [
		{ value: 'user', label: m.users_role_user() },
		{ value: 'admin', label: m.users_role_admin() }
	];
	const COLUMNS = [
		{ label: m.auth_field_name() },
		{ label: m.auth_field_email() },
		{ label: m.users_role(), class: 'w-32' },
		{ label: '', class: 'w-12' }
	];
	const roleOf = (u: Row): Role => (u.admin ? 'admin' : 'user');

	let users = $state<Row[]>([]);
	let loading = $state(true);

	// New-user form.
	let name = $state('');
	let email = $state('');
	let password = $state('');
	let role = $state<Role>('user');
	let creating = $state(false);

	const createLabel = $derived(creating ? m.users_adding() : m.action_add());

	async function load() {
		loading = true;
		const { data, error } = await core.GET('/api/admin/users');
		if (error) toast.error(m.users_toast_load_error());
		else users = data ?? [];
		loading = false;
	}

	onMount(load);

	async function create(e: SubmitEvent) {
		e.preventDefault();
		const refusal = passwordRefusal(password);
		if (refusal) {
			toast.error(refusal);
			return;
		}
		creating = true;
		const { error } = await core.POST('/api/admin/users', {
			body: { name, email, password, admin: role === 'admin' }
		});
		creating = false;
		if (error) {
			toast.error(apiErrorText(error, m.users_toast_create_error()));
			return;
		}
		toast.success(m.users_toast_created({ email }));
		name = email = password = '';
		role = 'user';
		await load();
	}

	async function setRole(id: number, next: Role) {
		const { error } = await core.PUT('/api/admin/users/{id}/role', {
			params: { path: { id } },
			body: { admin: next === 'admin' }
		});
		if (error) toast.error(apiErrorText(error, m.users_toast_role_error()));
		else {
			toast.success(m.users_toast_role_updated());
			await load();
		}
	}

	async function remove(id: number, label: string) {
		if (!confirm(m.users_remove_confirm({ label }))) return;
		const { error } = await core.DELETE('/api/admin/users/{id}', { params: { path: { id } } });
		if (error) toast.error(apiErrorText(error, m.users_toast_remove_error()));
		else {
			toast.success(m.users_toast_removed());
			await load();
		}
	}
</script>

<CreateRowForm
	title={m.users_add_title()}
	gridClass="sm:grid-cols-[1fr_1fr_1fr_auto_auto]"
	submitLabel={createLabel}
	busy={creating}
	onsubmit={create}
>
	<div class="flex flex-col gap-1.5">
		<Label for="u-name">{m.auth_field_name()}</Label>
		<Input id="u-name" bind:value={name} required />
	</div>
	<div class="flex flex-col gap-1.5">
		<Label for="u-email">{m.auth_field_email()}</Label>
		<Input id="u-email" type="email" autocomplete="off" bind:value={email} required />
	</div>
	<div class="flex flex-col gap-1.5">
		<Label for="u-password">{m.auth_field_password()}</Label>
		<Input
			id="u-password"
			type="password"
			autocomplete="new-password"
			bind:value={password}
			required
		/>
	</div>
	<div class="flex flex-col gap-1.5">
		<Label>{m.users_role()}</Label>
		<OptionSelect
			value={role}
			items={ROLES}
			onchange={(v) => (role = v as Role)}
			placeholder={m.users_role_user()}
			triggerClass="w-28"
		/>
	</div>
</CreateRowForm>

{#snippet userCells(u: Row)}
	<Table.Cell class="font-medium">{u.name}</Table.Cell>
	<Table.Cell class="text-muted-foreground">{u.email}</Table.Cell>
	<Table.Cell>
		<OptionSelect
			value={roleOf(u)}
			items={ROLES}
			onchange={(v) => setRole(u.id, v as Role)}
			placeholder="User"
			triggerClass="w-28"
		/>
	</Table.Cell>
	<Table.Cell>
		<RowRemoveButton label={m.users_remove_aria()} onclick={() => remove(u.id, u.email)} />
	</Table.Cell>
{/snippet}

<Section title={m.settings_tab_users()}>
	<DataTable
		{loading}
		loadingLabel={m.users_loading()}
		columns={COLUMNS}
		rows={users}
		cells={userCells}
	/>
</Section>
