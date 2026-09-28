<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$lib/resolve';
	import * as Card from '$lib/components/ui/card';
	import SetupShell from '$lib/components/setup/setup-shell.svelte';
	import { needsSetup } from '$lib/setup';
	import * as m from '$lib/paraglide/messages';
	import ShieldIcon from 'phosphor-svelte/lib/ShieldCheck';
	import AuthForm from '../../components/AuthForm.svelte';

	// First-run only: once an account exists, registration is closed.
	$effect(() => {
		needsSetup().then((setup) => {
			if (!setup) goto(resolve('/login'));
		});
	});
</script>

<!-- Step one of the same rail /setup continues, so creating the account reads
     as the start of setting up the plant rather than a separate sign-up page. -->
<SetupShell title={m.onboarding_title()} subtitle={m.onboarding_subtitle()} step="account" narrow>
	<Card.Root>
		<Card.Header>
			<Card.Title class="flex items-center gap-2">
				<ShieldIcon class="size-5 shrink-0 text-primary" weight="fill" />
				{m.onboarding_create_admin()}
			</Card.Title>
			<Card.Description>
				{m.onboarding_admin_desc()}
			</Card.Description>
		</Card.Header>
		<Card.Content>
			<AuthForm mode="signup" />
		</Card.Content>
	</Card.Root>
</SetupShell>
