<script lang="ts">
	import * as NativeSelect from '$lib/components/ui/native-select';
	import { connectionAddress } from '../devices/connection-draft';
	import type { ConnectionView } from '../devices/device-types';

	// One kind's connections as an optgroup. Grouping by kind is the change that
	// makes step 1 a wizard step rather than the old dialog's field: that one
	// listed Modbus gateways only, because a Modbus device was all it could add.
	let { label, rows }: { label: string; rows: readonly ConnectionView[] } = $props();
</script>

<NativeSelect.OptGroup {label}>
	{#each rows as row (row.id)}
		<NativeSelect.Option value={String(row.id)}>
			{row.name} · {connectionAddress(row)}
		</NativeSelect.Option>
	{/each}
</NativeSelect.OptGroup>
