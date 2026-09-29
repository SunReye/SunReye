<script lang="ts">
	import { Toaster as Sonner, type ToasterProps as SonnerProps } from "svelte-sonner";
	import { mode } from "mode-watcher";
	import SpinnerIcon from 'phosphor-svelte/lib/Spinner';
	import CheckCircleIcon from 'phosphor-svelte/lib/CheckCircle';
	import XCircleIcon from 'phosphor-svelte/lib/XCircle';
	import InfoIcon from 'phosphor-svelte/lib/Info';
	import WarningIcon from 'phosphor-svelte/lib/Warning';

	let { ...restProps }: SonnerProps = $props();

	// `--pinned-bottom` is the height of whatever action bar is pinned to the
	// bottom of the screen (the setup footer publishes it), so a toast stacks
	// above those actions instead of over them. Sonner's own gaps (24px, 16px
	// below 600px) are kept on top of it; the other edges keep its defaults.
	const offset = { bottom: 'calc(var(--pinned-bottom, 0px) + 24px)' };
	const mobileOffset = { bottom: 'calc(var(--pinned-bottom, 0px) + 16px)' };
</script>

<Sonner
	theme={mode.current}
	class="toaster group"
	{offset}
	{mobileOffset}
	style="--normal-bg: var(--color-popover); --normal-text: var(--color-popover-foreground); --normal-border: var(--color-border); font-family: var(--font-mono);"
	{...restProps}
>
	{#snippet loadingIcon()}
		<SpinnerIcon class="size-4 animate-spin" />
	{/snippet}
	{#snippet successIcon()}
		<CheckCircleIcon class="size-4" />
	{/snippet}
	{#snippet errorIcon()}
		<XCircleIcon class="size-4" />
	{/snippet}
	{#snippet infoIcon()}
		<InfoIcon class="size-4" />
	{/snippet}
	{#snippet warningIcon()}
		<WarningIcon class="size-4" />
	{/snippet}
</Sonner>
