<script lang="ts">
	import type { Snippet } from 'svelte';
	import Logo from '$lib/components/logo.svelte';
	import SetupStepper from './setup-stepper.svelte';
	import { SETUP_STEPS, type SetupStep, stepIndex } from './setup-steps';

	// The frame of the whole first-run journey — `/onboarding` and `/setup` both.
	// They used to be two different pages: a centred auth card with no rail, then
	// a wizard whose rail started at "Profile", so creating the account read as a
	// separate product.
	//
	// The DOCUMENT scrolls, not an inner box: the wizard's old `overflow-y-auto`
	// wrapper took the scroll away from the page, and a sticky footer inside it
	// had nothing to stick to. The footer is where each step's Back / Continue
	// live, pinned to the bottom of a phone screen so the next step is never a
	// scroll past a long profile list away.
	let {
		title,
		subtitle,
		step,
		narrow = false,
		children,
		footer
	}: {
		title: string;
		subtitle: string;
		step: SetupStep;
		/** A single form (the account step) rather than a list. */
		narrow?: boolean;
		children: Snippet;
		footer?: Snippet;
	} = $props();

	const steps = $derived(SETUP_STEPS.map((s) => ({ key: s.key, label: s.label() })));
	const current = $derived(stepIndex(step));
	const measure = $derived(narrow ? 'max-w-md' : 'max-w-2xl');
</script>

<div class="relative flex min-h-svh flex-col bg-background">
	<!-- Faint blueprint grid; industrial-console backdrop. Fixed, so it does not
	     scroll away with a long step. -->
	<div
		class="pointer-events-none fixed inset-0 opacity-[0.35] bg-[linear-gradient(to_right,var(--color-border)_1px,transparent_1px),linear-gradient(to_bottom,var(--color-border)_1px,transparent_1px)] bg-size-[44px_44px] mask-[radial-gradient(ellipse_at_center,black,transparent_75%)]"
		aria-hidden="true"
	></div>

	<main class="relative mx-auto flex w-full {measure} flex-1 flex-col gap-6 px-4 pt-8 pb-6 sm:pt-12">
		<header class="flex flex-col items-center gap-3 text-center">
			<Logo class="size-10 text-primary sm:size-12" />
			<div>
				<h1 class="text-xl font-semibold tracking-tight">{title}</h1>
				<p class="text-sm text-muted-foreground">{subtitle}</p>
			</div>
		</header>

		<SetupStepper {steps} {current} />

		{@render children()}
	</main>

	{#if footer}
		<div
			class="sticky bottom-0 z-20 border-t border-border bg-background/90 backdrop-blur supports-backdrop-filter:bg-background/75"
			data-setup-footer
		>
			<div
				class="mx-auto flex w-full {measure} items-center justify-between gap-2 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]"
			>
				{@render footer()}
			</div>
		</div>
	{/if}
</div>
