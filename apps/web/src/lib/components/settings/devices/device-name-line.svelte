<script lang="ts">
	import { Badge } from '$lib/components/ui/badge';
	import DeviceStateBadge from './device-state-badge.svelte';
	import type { DeviceView } from './device-types';
	import { roleLabel } from './role-label';

	// WHAT A DEVICE IS, in one wrapping line: its name, its role, and why it is
	// or is not being read.
	//
	// Two surfaces render a device — its row on the roster, and the list of what
	// an integration provides — and this line was identical in both. Shared so
	// the answer to "is this thing polling" cannot come out differently on two
	// pages showing the same device.
	//
	// It wraps rather than truncating: the badges are what tell two similarly
	// named devices apart, and at 400px an ellipsis eats them first.
	let { device }: { device: DeviceView } = $props();
</script>

<span class="flex flex-wrap items-center gap-1.5 text-sm font-medium">
	<span class="wrap-break-word">{device.name}</span>
	<Badge variant="outline">{roleLabel(device.role)}</Badge>
	<DeviceStateBadge {device} />
</span>
