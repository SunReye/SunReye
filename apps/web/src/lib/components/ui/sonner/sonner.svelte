<script lang="ts">
	import { mode } from "mode-watcher";
	import { Toaster as Sonner, type ToasterProps as SonnerProps } from "svelte-sonner";
	import Loader2Icon from '@lucide/svelte/icons/loader-2';
	import CircleCheckIcon from '@lucide/svelte/icons/circle-check';
	import OctagonXIcon from '@lucide/svelte/icons/octagon-x';
	import InfoIcon from '@lucide/svelte/icons/info';
	import TriangleAlertIcon from '@lucide/svelte/icons/triangle-alert';

	let { ...restProps }: SonnerProps = $props();
</script>

<Sonner
	theme={mode.current}
	class="toaster group"
	style="--normal-bg: var(--color-popover); --normal-text: var(--color-popover-foreground); --normal-border: var(--color-border);"
	toastOptions={{
		classes: {
			// Local: svelte-sonner's own CSS hard-codes 400ms ease (enter, leave, restack, children) and 200ms ease-out (swipe-out); it exposes no variables, so the toast's classes set the motion item's duration and easing, `!` to beat its attribute selectors (#38).
			// Local: glass! (translucent, blurred, grain; the theme item's tokens) on the toast, `!` to beat svelte-sonner's `background: var(--normal-bg)`, which outranks a utility; only where `richColors` is off, so a rich toast keeps its own tint (#39).
			toast: "cn-toast data-[rich-colors=false]:glass! duration-(--motion-base)! ease-(--motion-ease)! *:duration-(--motion-base)! *:ease-(--motion-ease)! data-[swipe-out=true]:[animation-duration:var(--motion-base)]! data-[swipe-out=true]:[animation-timing-function:var(--motion-ease)]!",
			// Local: svelte-sonner's cancel button is a translucent white (30%) in dark, which on glass drops its text below 4.5:1; an opaque muted chip on a glass toast, `!` to beat its selectors (#39).
			cancelButton: "in-data-[rich-colors=false]:bg-muted!",
		},
	}}
	{...restProps}
>
	{#snippet loadingIcon()}
		<Loader2Icon class="size-4 animate-spin" />
	{/snippet}
	{#snippet successIcon()}
		<CircleCheckIcon class="size-4" />
	{/snippet}
	{#snippet errorIcon()}
		<OctagonXIcon class="size-4" />
	{/snippet}
	{#snippet infoIcon()}
		<InfoIcon class="size-4" />
	{/snippet}
	{#snippet warningIcon()}
		<TriangleAlertIcon class="size-4" />
	{/snippet}
</Sonner>
