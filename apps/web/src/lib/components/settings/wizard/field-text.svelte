<script lang="ts">
	import { Input } from '$lib/components/ui/input';
	import type { CatalogField } from './add-wizard';

	let { field, id, value = $bindable() }: { field: CatalogField; id: string; value: unknown } =
		$props();
</script>

<Input
	{id}
	maxlength={field.max}
	value={String(value ?? '')}
	oninput={(e) => (value = e.currentTarget.value)}
/>
