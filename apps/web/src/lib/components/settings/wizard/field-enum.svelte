<script lang="ts">
	import * as NativeSelect from '$lib/components/ui/native-select';
	import type { CatalogField } from './add-wizard';

	let { field, id, value = $bindable() }: { field: CatalogField; id: string; value: unknown } =
		$props();
</script>

<NativeSelect.Root {id} value={String(value ?? '')} onchange={(e) => (value = e.currentTarget.value)}>
	{#each field.options ?? [] as option (option)}
		<NativeSelect.Option value={option}>{option}</NativeSelect.Option>
	{/each}
</NativeSelect.Root>
