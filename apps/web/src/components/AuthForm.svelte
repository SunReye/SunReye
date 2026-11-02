<script lang="ts">
	import { z } from 'zod';
	import { goto } from '$app/navigation';
	import { resolve } from '$lib/resolve';
	import { passwordRefusal } from '$lib/password';
	import { signIn, signUp } from '$lib/session';
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
					password: z.string().check((ctx) => {
						const message = passwordRefusal(ctx.value);
						if (message) ctx.issues.push({ code: 'custom', message, input: ctx.value });
					})
				})
			: z.object({
					email: z.email(m.auth_email_invalid()),
					password: z.string().min(1, m.auth_password_required())
				})
	);

	let name = $state('');
	let email = $state('');
	let password = $state('');
	// Keep the session for a year; unchecked, the cookie ends when the browser closes.
	// Sign-in only; irrelevant to sign-up.
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
		if (mode === 'signup') return signUp({ name, email, password });
		return signIn({ email, password, rememberMe });
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
		const result = await submitCredentials();
		if (!result.ok) {
			failWith(result.message);
			return;
		}
		goto(resolve('/'));
		submitting = false;
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
