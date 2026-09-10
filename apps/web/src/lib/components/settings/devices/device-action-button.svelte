<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import * as m from '$lib/paraglide/messages';
	import { resolve } from '$lib/resolve';
	import type { DeviceAction, DeviceActionId } from './device-actions-logic';

	// ONE control of a device row. Its own component so the per-control lookups
	// — label, framing, the one action that is a link — sit here rather than as a
	// branch each in the row's template, which was the most complex thing on the
	// panel before `./device-actions-logic.ts` turned the rule into a list.
	let {
		action,
		busy,
		onclick
	}: {
		action: DeviceAction;
		busy: boolean;
		onclick: () => void;
	} = $props();

	const LABEL: Record<DeviceActionId, () => string> = {
		restore: m.devices_action_restore,
		edit: m.devices_action_edit,
		rename: m.devices_action_rename,
		configure: m.devices_action_configure,
		retire: m.devices_action_retire
	};

	// Retire is the one control that takes something away, so it is the quiet
	// one; everything else is framed the same.
	const VARIANT: Record<DeviceActionId, 'ghost' | 'outline'> = {
		restore: 'outline',
		edit: 'outline',
		rename: 'outline',
		configure: 'outline',
		retire: 'ghost'
	};

	/** The controls that are a link rather than a request. */
	const LINK = { configure: '/settings/mqtt' } as const;

	const href = $derived(
		action.id in LINK ? resolve(LINK[action.id as keyof typeof LINK]) : undefined
	);
	// A blocked control is rendered and refused, and the hint is the reason —
	// only the polled device is blocked, and only from being retired.
	const title = $derived(action.blocked ? m.devices_not_polled_hint() : undefined);
</script>

<Button
	variant={VARIANT[action.id]}
	size="sm"
	class="flex-1 sm:flex-none"
	disabled={busy || action.blocked}
	{title}
	{href}
	{onclick}
>
	{LABEL[action.id]()}
</Button>
