<script lang="ts">
	import { z } from 'zod';
	import { authClient } from '$lib/auth-client';
	import { goto } from '$app/navigation';
	import { resolve } from '$lib/resolve';
	import { Button } from '$lib/components/ui/button';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import * as m from '$lib/paraglide/messages';
	import AuthField from './AuthField.svelte';

	let { mode }: { mode: 'signin' | 'signup' } = $props();

	const isSignup = $derived(mode === 'signup');
	const isSignin = $derived(mode === 'signin');

	const schema = $derived(
		mode === 'signup'
			? z.object({
					name: z.string().min(2, m.auth_name_min()),
					email: z.email(m.auth_email_invalid()),
					password: z.string().min(8, m.auth_password_min())
				})
			: z.object({
					email: z.email(m.auth_email_invalid()),
					password: z.string().min(1, m.auth_password_required())
				})
	);

	let name = $state('');
	let email = $state('');
	let password = $state('');
	// Persist the session across browser restarts (paired with the server's long
	// session lifetime). When unchecked the session cookie is browser-scoped and
	// ends when the browser closes. Sign-in only; irrelevant to sign-up.
	let rememberMe = $state(true);
	let errors = $state<{ name?: string; email?: string; password?: string }>({});
	let formError = $state('');
	let submitting = $state(false);

	// Mode- and progress-dependent copy, resolved here so the markup stays flat.
	const passwordAutocomplete = $derived(isSignup ? 'new-password' : 'current-password');
	const passwordPlaceholder = $derived(
		isSignup ? m.auth_placeholder_password_new() : '••••••••'
	);
	const submitLabel = $derived(isSignup ? m.auth_create_account() : m.login_title());
	const pendingLabel = $derived(isSignup ? m.auth_creating_account() : m.auth_signing_in());
	const buttonLabel = $derived(submitting ? pendingLabel : submitLabel);

	/** First message per field from a Zod flatten, for the inline field errors. */
	function fieldErrorsOf(error: z.ZodError): typeof errors {
		const flat = z.flattenError(error).fieldErrors as Record<string, string[]>;
		return { name: flat.name?.[0], email: flat.email?.[0], password: flat.password?.[0] };
	}

	/** Create the account or sign in, depending on the form's mode. */
	function submitCredentials() {
		if (mode === 'signup') return authClient.signUp.email({ name, email, password });
		return authClient.signIn.email({ email, password, rememberMe });
	}

	/** Surface a failed attempt and re-enable the form. */
	function failWith(message: string | undefined): void {
		formError = message || m.auth_error_generic();
		submitting = false;
	}

	async function handleSubmit(e: SubmitEvent) {
		e.preventDefault();
		formError = '';
		const parsed = schema.safeParse({ name, email, password });
		if (!parsed.success) {
			errors = fieldErrorsOf(parsed.error);
			return;
		}
		errors = {};
		submitting = true;
		const { error } = await submitCredentials();
		if (error) {
			failWith(error.message);
			return;
		}
		// Wait until the reactive session store reflects the new cookie before
		// navigating. Better Auth refreshes `useSession()` asynchronously (a delayed
		// signal after sign-in), so navigating immediately races that refresh: the
		// `(app)` guard reads a stale `data: null` and bounces straight back here,
		// which is why the first login used to need a second try or a reload.
		await waitForSession();
		goto(resolve('/'));
		submitting = false;
	}

	/** Resolve once `useSession()` reports an authenticated session (or we time out). */
	function waitForSession(timeoutMs = 3000): Promise<void> {
		// Kick a fresh fetch (updates the shared store) and settle as soon as it lands.
		void authClient.getSession({ query: { disableCookieCache: true } });
		const session = authClient.useSession();
		return new Promise((done) => {
			let settled = false;
			const finish = () => {
				if (settled) return;
				settled = true;
				unsubscribe();
				clearTimeout(timer);
				done();
			};
			const timer = setTimeout(finish, timeoutMs);
			const unsubscribe = session.subscribe((s) => {
				if (s.data) finish();
			});
		});
	}
</script>

<form class="flex flex-col gap-4" onsubmit={handleSubmit}>
	{#if isSignup}
		<AuthField
			id="name"
			label={m.auth_field_name()}
			autocomplete="name"
			placeholder="Ada Lovelace"
			error={errors.name}
			bind:value={name}
		/>
	{/if}
	<AuthField
		id="email"
		label={m.auth_field_email()}
		type="email"
		autocomplete="email"
		placeholder="you@example.com"
		error={errors.email}
		bind:value={email}
	/>
	<AuthField
		id="password"
		label={m.auth_field_password()}
		type="password"
		autocomplete={passwordAutocomplete}
		placeholder={passwordPlaceholder}
		error={errors.password}
		bind:value={password}
	/>

	{#if isSignin}
		<label class="flex cursor-pointer items-center gap-2 text-sm">
			<Checkbox bind:checked={rememberMe} />
			<span>{m.auth_keep_signed_in()}</span>
		</label>
	{/if}

	{#if formError}
		<p class="text-sm text-destructive" role="alert">{formError}</p>
	{/if}

	<Button type="submit" class="w-full" disabled={submitting}>
		{buttonLabel}
	</Button>
</form>
