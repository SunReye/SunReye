<script lang="ts">
	import type { Component } from 'svelte';
	import type { Pathname } from '$app/types';
	import { page } from '$app/state';
	import { fly } from 'svelte/transition';
	import { MediaQuery } from 'svelte/reactivity';
	import { api } from '$lib/api';
	import { resolve, routePath } from '$lib/resolve';
	import { useAppSession } from '$lib/session';
	import { setSettingsStatus, type SettingsStatus } from './status-context';
	import { setPageHeader } from '$lib/page-header.svelte';
	import * as m from '$lib/paraglide/messages';
	import LightningIcon from 'phosphor-svelte/lib/Lightning';
	import WaveformIcon from 'phosphor-svelte/lib/Waveform';
	import BroadcastIcon from 'phosphor-svelte/lib/Broadcast';
	import MonitorIcon from 'phosphor-svelte/lib/Monitor';
	import ReceiptIcon from 'phosphor-svelte/lib/Receipt';
	import CloudSunIcon from 'phosphor-svelte/lib/CloudSun';
	import ShieldCheckIcon from 'phosphor-svelte/lib/ShieldCheck';
	import StackIcon from 'phosphor-svelte/lib/Stack';
	import UsersIcon from 'phosphor-svelte/lib/Users';
	import KeyIcon from 'phosphor-svelte/lib/Key';
	import TerminalWindowIcon from 'phosphor-svelte/lib/TerminalWindow';
	import RobotIcon from 'phosphor-svelte/lib/Robot';
	import WarningIcon from 'phosphor-svelte/lib/Warning';

	const { children } = $props();

	const session = useAppSession();
	const isAdmin = $derived($session.data?.user.role === 'admin');

	// The hash router pins `page.url.pathname` to the served document, so the
	// active route has to be read from the hash (see `routePath`).
	const current = $derived(routePath(page.url));

	type NavItem = { href: Pathname; label: string; icon: Component };
	type NavGroup = { label: string; items: NavItem[] };

	// Profiles/Access/Users/API keys/Danger zone are admin-only management
	// surfaces; the group is appended once we know the viewer is an admin.
	const groups = $derived<NavGroup[]>([
		{
			label: m.settings_group_connection(),
			items: [
				{ href: '/settings/inverter', label: m.label_inverter(), icon: LightningIcon },
				{ href: '/settings/sensors', label: m.settings_tab_sensors(), icon: WaveformIcon },
				{ href: '/settings/mqtt', label: m.settings_tab_mqtt(), icon: BroadcastIcon }
			]
		},
		{
			label: m.settings_group_preferences(),
			items: [
				{ href: '/settings/display', label: m.settings_tab_display(), icon: MonitorIcon },
				{ href: '/settings/tariff', label: m.settings_tab_tariff(), icon: ReceiptIcon },
				{ href: '/settings/weather', label: m.settings_tab_weather(), icon: CloudSunIcon }
			]
		},
		...(isAdmin
			? [
					{
						label: m.settings_group_admin(),
						items: [
							{ href: '/settings/access', label: m.settings_tab_access(), icon: ShieldCheckIcon },
							{
								href: '/settings/automations',
								label: m.settings_tab_automations(),
								icon: RobotIcon
							},
							{ href: '/settings/profiles', label: m.settings_tab_profiles(), icon: StackIcon },
							{ href: '/settings/users', label: m.settings_tab_users(), icon: UsersIcon },
							{ href: '/settings/api-keys', label: m.settings_tab_apikeys(), icon: KeyIcon },
							{ href: '/settings/logs', label: m.settings_tab_logs(), icon: TerminalWindowIcon },
							{ href: '/settings/danger', label: m.settings_tab_danger(), icon: WarningIcon }
						]
					} satisfies NavGroup
				]
			: [])
	]);

	// Flattened list drives the mobile scroll row (groups collapse to one line
	// there — the section headers only earn their space on the desktop rail).
	const flatItems = $derived(groups.flatMap((g) => g.items));

	// Live connection health, polled once for the whole settings area and shared
	// with the Inverter/MQTT panels through context.
	let status = $state<SettingsStatus>(null);
	setSettingsStatus({
		get current() {
			return status;
		}
	});

	$effect(() => {
		let stop = false;
		const tick = async () => {
			const { data } = await api.api.status.get();
			if (!stop && data) status = data as SettingsStatus;
		};
		tick();
		const id = setInterval(tick, 3000);
		return () => {
			stop = true;
			clearInterval(id);
		};
	});

	// Only the changing panel moves; the nav rail stays put. Honour reduced motion.
	const reduceMotion = new MediaQuery('prefers-reduced-motion: reduce');
	const panelIn = $derived(reduceMotion.current ? { duration: 0 } : { y: 6, duration: 180 });

	$effect(() => setPageHeader(m.nav_settings(), m.settings_subtitle()));
</script>

<div class="mx-auto w-full max-w-5xl p-4 sm:p-6">
	{#snippet navLink(item: NavItem, extra: string)}
		{@const Icon = item.icon}
		{@const active = current === item.href}
		<a
			href={resolve(item.href)}
			aria-current={active ? 'page' : undefined}
			class="flex items-center rounded-md text-sm transition-colors {extra} {active
				? 'bg-muted font-medium text-foreground'
				: 'text-muted-foreground hover:bg-muted/50 hover:text-foreground'}"
		>
			<Icon class="size-4 shrink-0" weight={active ? 'fill' : 'regular'} />
			<span class="truncate">{item.label}</span>
		</a>
	{/snippet}

	<div class="flex flex-col gap-6 md:grid md:grid-cols-[13rem_minmax(0,1fr)] md:gap-10">
		<!-- Desktop: grouped vertical menu. -->
		<nav class="hidden md:block" aria-label={m.nav_settings()}>
			<div class="sticky top-6 flex flex-col gap-6">
				{#each groups as group (group.label)}
					<div class="flex flex-col gap-1">
						<p
							class="px-2 pb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground/70"
						>
							{group.label}
						</p>
						{#each group.items as item (item.href)}
							{@render navLink(item, 'gap-2.5 px-2 py-1.5')}
						{/each}
					</div>
				{/each}
			</div>
		</nav>

		<!-- Mobile: single-line horizontal scroll of every panel. -->
		<nav
			class="-mx-4 overflow-x-auto px-4 md:hidden"
			aria-label={m.nav_settings()}
		>
			<div class="flex w-max gap-1 pb-1">
				{#each flatItems as item (item.href)}
					{@render navLink(item, 'shrink-0 gap-2 border border-transparent px-3 py-1.5')}
				{/each}
			</div>
		</nav>

		<div class="min-w-0">
			{#key current}
				<div class="flex flex-col gap-6" in:fly={panelIn}>
					{@render children()}
				</div>
			{/key}
		</div>
	</div>
</div>
