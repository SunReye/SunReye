<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$lib/resolve';
	import * as Card from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';
	import { publicDashboardEnabled } from '$lib/engine-admin';
	import { needsSetup } from '$lib/setup';
	import * as m from '$lib/paraglide/messages';
	import AuthForm from '../../components/AuthForm.svelte';
	import AuthShell from '../../components/AuthShell.svelte';

	// First-run: no account yet → send visitors to admin onboarding. Registration
	// is otherwise closed (invite-only), so this page is sign-in only.
	$effect(() => {
		needsSetup().then((setup) => {
			if (setup) goto(resolve('/onboarding'));
		});
	});

	// Offer a way into the read-only dashboard without signing in, but only when
	// the admin has actually enabled it (otherwise the reads would 401).
	let publicDashboard = $state(false);
	$effect(() => {
		publicDashboardEnabled().then((ok) => (publicDashboard = ok));
	});
</script>

<AuthShell title="SunReye" subtitle={m.brand_tagline()}>
	<Card.Root>
		<Card.Header>
			<Card.Title>{m.login_title()}</Card.Title>
			<Card.Description>{m.login_description()}</Card.Description>
		</Card.Header>
		<Card.Content>
			<AuthForm mode="signin" />
			{#if publicDashboard}
				<div class="mt-4 text-center">
					<Button variant="link" size="sm" href={resolve('/')}>
						{m.access_view_dashboard()}
					</Button>
				</div>
			{/if}
		</Card.Content>
	</Card.Root>
</AuthShell>
