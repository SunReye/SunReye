<script lang="ts">
	import type { Component } from 'svelte';
	import type { Pathname } from '$app/types';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { resolve, routePath } from '$lib/resolve';
	import * as Sidebar from '$lib/components/ui/sidebar';
	import Logo from '$lib/components/logo.svelte';
	import { authClient } from '$lib/auth-client';
	import { useAppSession } from '$lib/session';
	import { inverter } from '$lib/inverter/store.svelte';
	import * as m from '$lib/paraglide/messages';
	import GaugeIcon from 'phosphor-svelte/lib/Gauge';
	import CpuIcon from 'phosphor-svelte/lib/Cpu';
	import ChartLineIcon from 'phosphor-svelte/lib/ChartLine';
	import SlidersIcon from 'phosphor-svelte/lib/SlidersHorizontal';
	import RobotIcon from 'phosphor-svelte/lib/Robot';
	import CoinsIcon from 'phosphor-svelte/lib/Coins';
	import GearIcon from 'phosphor-svelte/lib/Gear';
	import SignOutIcon from 'phosphor-svelte/lib/SignOut';
	import SignInIcon from 'phosphor-svelte/lib/SignIn';
	import UserIcon from 'phosphor-svelte/lib/User';

	const sessionQuery = useAppSession();
	const sidebar = Sidebar.useSidebar();

	// The hash router pins `page.url.pathname` to the served document path, so
	// the active route has to come from the hash (see `routePath`).
	const current = $derived(routePath(page.url));

	// Controls (live inverter writes) and Settings (config) are admin-only; the
	// server enforces this on every mutation, and we hide the nav entries for
	// non-admins so they never see areas they can't use.
	const isAdmin = $derived($sessionQuery.data?.user?.role === 'admin');

	type NavItem = { href: Pathname; label: string; icon: Component };

	const items = $derived<NavItem[]>([
		{ href: '/', label: m.nav_overview(), icon: GaugeIcon },
		{ href: '/system', label: m.nav_system(), icon: CpuIcon },
		{ href: '/history', label: m.nav_history(), icon: ChartLineIcon },
		{ href: '/costs', label: m.nav_costs(), icon: CoinsIcon },
		...(isAdmin && (inverter.capabilities?.controls.length ?? 0) > 0
			? ([{ href: '/controls', label: m.nav_controls(), icon: SlidersIcon }] satisfies NavItem[])
			: []),
		...(isAdmin
			? ([{ href: '/automations', label: m.nav_automations(), icon: RobotIcon }] satisfies NavItem[])
			: [])
	]);

	// The sidebar is an overlay on every viewport, so dismiss it as soon as the
	// user picks a destination.
	function closeSidebar() {
		sidebar.setOpenMobile(false);
	}

	const userName = $derived(
		$sessionQuery.data?.user?.name ||
			$sessionQuery.data?.user?.email?.split('@')[0] ||
			m.nav_signed_in()
	);

	async function signOut() {
		await authClient.signOut({ fetchOptions: { onSuccess: () => goto(resolve('/login')) } });
	}
</script>

<Sidebar.Root collapsible="icon">
	<Sidebar.Header>
		<div class="flex items-center gap-2 px-1 py-1.5">
			<Logo class="size-8 shrink-0 text-primary" />
			<div class="flex min-w-0 flex-col group-data-[collapsible=icon]:hidden">
				<span class="text-sm font-semibold leading-tight">SunReye</span>
				<span class="truncate text-xs text-muted-foreground">
					{inverter.manifest
						? `${inverter.manifest.manufacturer} · ${inverter.manifest.name}`
						: m.app_loading()}
				</span>
			</div>
		</div>
	</Sidebar.Header>

	<Sidebar.Content>
		<Sidebar.Group>
			<Sidebar.GroupLabel>{m.nav_monitoring()}</Sidebar.GroupLabel>
			<Sidebar.GroupContent>
				<Sidebar.Menu>
					{#each items as item (item.href)}
						{@const Icon = item.icon}
						<Sidebar.MenuItem>
							<Sidebar.MenuButton isActive={current === item.href}>
								{#snippet child({ props })}
									<a href={resolve(item.href)} onclick={closeSidebar} {...props}>
										<Icon class="size-4" />
										<span>{item.label}</span>
									</a>
								{/snippet}
							</Sidebar.MenuButton>
						</Sidebar.MenuItem>
					{/each}
				</Sidebar.Menu>
			</Sidebar.GroupContent>
		</Sidebar.Group>
	</Sidebar.Content>

	<Sidebar.Footer>
		<Sidebar.Menu>
			{#if isAdmin}
				<Sidebar.MenuItem>
					<Sidebar.MenuButton isActive={current === '/settings' || current.startsWith('/settings/')}>
						{#snippet child({ props })}
							<a href={resolve('/settings')} onclick={closeSidebar} {...props}>
								<GearIcon class="size-4" />
								<span>{m.nav_settings()}</span>
							</a>
						{/snippet}
					</Sidebar.MenuButton>
				</Sidebar.MenuItem>
			{/if}
			{#if $sessionQuery.data}
				<Sidebar.MenuItem>
					<div
						class="flex items-center gap-2 px-2 py-1.5 text-sm text-muted-foreground group-data-[collapsible=icon]:hidden"
					>
						<UserIcon class="size-4 shrink-0" />
						<span class="truncate">{userName}</span>
					</div>
				</Sidebar.MenuItem>
				<Sidebar.MenuItem>
					<Sidebar.MenuButton>
						{#snippet child({ props })}
							<button type="button" onclick={signOut} {...props}>
								<SignOutIcon class="size-4" />
								<span>{m.nav_sign_out()}</span>
							</button>
						{/snippet}
					</Sidebar.MenuButton>
				</Sidebar.MenuItem>
			{:else}
				<!-- Anonymous read-only viewer: the footer becomes the way in. -->
				<Sidebar.MenuItem>
					<Sidebar.MenuButton>
						{#snippet child({ props })}
							<a href={resolve('/login')} onclick={closeSidebar} {...props}>
								<SignInIcon class="size-4" />
								<span>{m.nav_log_in()}</span>
							</a>
						{/snippet}
					</Sidebar.MenuButton>
				</Sidebar.MenuItem>
			{/if}
		</Sidebar.Menu>
	</Sidebar.Footer>

	<Sidebar.Rail />
</Sidebar.Root>
