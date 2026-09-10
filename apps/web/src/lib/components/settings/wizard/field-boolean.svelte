<script lang="ts">
	import { Checkbox } from '$lib/components/ui/checkbox';
	import type { CatalogField } from './add-wizard';

	let { id, value = $bindable() }: { field: CatalogField; id: string; value: unknown } = $props();
</script>

<Checkbox {id} checked={value === true} onCheckedChange={(v) => (value = v === true)} />
