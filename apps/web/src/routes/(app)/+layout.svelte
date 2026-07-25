<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve, routePath } from '$lib/resolve';
	import { page } from '$app/state';
	import { fade } from 'svelte/transition';
	import { MediaQuery } from 'svelte/reactivity';
	import * as Sidebar from '$lib/components/ui/sidebar';
	import AppSidebar from '$lib/components/app-sidebar.svelte';
	import { useAppSession } from '$lib/session';
	import { firstRunGate, publicDashboardEnabled, type FirstRunGate } from '$lib/setup';
	import { inverter } from '$lib/inverter/store.svelte';
	import { display } from '$lib/display.svelte';
	import { pageHeader } from '$lib/page-header.svelte';
	import * as m from '$lib/paraglide/messages';

	const { children } = $props();

	const sessionQuery = useAppSession();

	// The hash router pins `page.url.pathname` to the served document path, so
	// the active route has to come from the hash (see `routePath`).
	const current = $derived(routePath(page.url));

	// The top-level section, e.g. '/settings/inverter' → '/settings'. Drives the
	// header title, the admin guard, and the content transition so that moving
	// between a section's subroutes (Settings panels) keeps the shell — and the
	// section's own nav rail — stable instead of re-fading the whole area.
	const topSegment = $derived('/' + (current.split('/')[1] ?? ''));

	// Access model. A logged-out visitor is not necessarily bounced to login: when
	// the admin has enabled the public dashboard, the server serves dashboard reads
	// + the live stream anonymously, so we show a read-only workspace instead.
	// `anonAllowed` is null until we've probed the public flag, so the shell shows a
	// loading state rather than flashing a login redirect.
	const isAdmin = $derived($sessionQuery.data?.user?.role === 'admin');
	let anonAllowed = $state<boolean | null>(null);
	const isAnon = $derived(!$sessionQuery.isPending && !$sessionQuery.data && anonAllowed === true);

	$effect(() => {
		if ($sessionQuery.isPending || $sessionQuery.data) return;
		// Logged out. Decide read-only dashboard vs login.
		if (anonAllowed === false) {
			goto(resolve('/login'));
			return;
		}
		if (anonAllowed !== null) return;
		publicDashboardEnabled().then((ok) => {
			// A session may have arrived mid-probe (e.g. we just signed in) — defer to
			// the authenticated path rather than treating the visitor as anonymous.
			if ($sessionQuery.data) return;
			anonAllowed = ok;
			if (!ok) goto(resolve('/login'));
		});
	});

	// First-run gate, in precedence order: no admin yet → `/onboarding`; admin but
	// no active profile (server booted onboarding-only, so there's no manifest or
	// live data) → `/setup`; otherwise render the workspace. `gate` is null until
	// the check resolves, so the shell never flashes before we know where to go.
	// Anonymous viewers skip this — they only ever reach the read-only dashboard.
	let gate = $state<FirstRunGate | null>(null);
	$effect(() => {
		if ($sessionQuery.isPending || !$sessionQuery.data || gate) return;
		firstRunGate().then((g) => {
			gate = g;
			if (g === 'setup-account') goto(resolve('/onboarding'));
			else if (g === 'setup-profile') goto(resolve('/setup'));
		});
	});

	// Admin-only areas (Settings + Controls). The server enforces every mutation;
	// this bounces anyone without admin — authenticated non-admins and anonymous
	// viewers alike — who reaches the page by direct URL. The nav hides these
	// entries too (app-sidebar.svelte).
	const ADMIN_ONLY = ['/settings', '/controls'];
	$effect(() => {
		if ($sessionQuery.isPending || isAdmin) return;
		// Skip while a logged-out visitor is still being classified (login vs anon);
		// the access effect above sends unauthorised anonymous users to /login.
		if (!$sessionQuery.data && anonAllowed !== true) return;
		if (ADMIN_ONLY.includes(topSegment)) goto(resolve('/'));
	});

	// Open the manifest + live stream once the instance is fully configured
	// (skipped in onboarding-only boot, where `/api/profile` has no manifest), or
	// for an anonymous read-only viewer (reads + stream are anon-allowed).
	$effect(() => {
		if (gate === 'ready' || isAnon) {
			inverter.start();
			// Load the instance-wide clock/time-zone preference so charts render in
			// the configured format from first paint.
			display.load();
		}
	});

	// Subtle route-to-route motion: the shell (sidebar) stays put while the inner
	// content cross-fades up on each navigation. Honour reduced-motion.
	const reduceMotion = new MediaQuery('prefers-reduced-motion: reduce');
	const contentIn = $derived(reduceMotion.current ? { duration: 0 } : { duration: 200 });
</script>

{#snippet shell()}
	<Sidebar.Provider>
		<AppSidebar />
		<Sidebar.Inset>
			<!-- Persistent top header on every viewport: sidebar trigger + the active
			     page's title/subtitle (set by each page via the page-header store). -->
			<header
				class="sticky top-0 z-10 flex h-14 shrink-0 items-center gap-3 border-b border-border bg-background px-4"
			>
				<Sidebar.Trigger />
				<div class="flex min-w-0 flex-col">
					<h1 class="truncate text-base font-semibold leading-tight">{pageHeader.title}</h1>
					{#if pageHeader.subtitle}
						<p class="truncate text-xs leading-tight text-muted-foreground">
							{pageHeader.subtitle}
						</p>
					{/if}
				</div>
			</header>
			<main class="min-h-0 flex-1 overflow-y-auto">
				{#key topSegment}
					<div in:fade={contentIn}>
						{@render children()}
					</div>
				{/key}
			</main>
		</Sidebar.Inset>
	</Sidebar.Provider>
{/snippet}

{#if $sessionQuery.isPending}
	<div class="grid h-svh place-items-center text-muted-foreground">{m.app_loading()}</div>
{:else if !$sessionQuery.data}
	{#if anonAllowed === null}
		<div class="grid h-svh place-items-center text-muted-foreground">{m.app_loading()}</div>
	{:else if anonAllowed}
		{@render shell()}
	{:else}
		<div class="grid h-svh place-items-center text-muted-foreground">{m.app_redirecting_login()}</div>
	{/if}
{:else if gate === null}
	<div class="grid h-svh place-items-center text-muted-foreground">{m.app_loading()}</div>
{:else if gate !== 'ready'}
	<div class="grid h-svh place-items-center text-muted-foreground">{m.app_redirecting()}</div>
{:else}
	{@render shell()}
{/if}
