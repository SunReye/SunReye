<script lang="ts" generics="Row extends { id: string }">
	import type { Snippet } from 'svelte';
	import * as Table from '$lib/components/ui/table';

	// Shared shell for the admin settings tables (users, API keys): the
	// loading/empty message, the header row and the keyed body loop. `cells`
	// renders the `<Table.Cell>`s of one row.
	let {
		loading,
		loadingLabel,
		emptyLabel,
		columns,
		rows,
		cells
	}: {
		loading: boolean;
		loadingLabel: string;
		/** Shown instead of the table when `rows` is empty; omit to always render it. */
		emptyLabel?: string;
		/** Header labels in column order; `class` carries the column width. */
		columns: { label: string; class?: string }[];
		rows: Row[];
		cells: Snippet<[Row]>;
	} = $props();

	const message = $derived(
		loading ? loadingLabel : rows.length === 0 ? (emptyLabel ?? null) : null
	);
</script>

{#if message !== null}
	<p class="text-sm text-muted-foreground">{message}</p>
{:else}
	<Table.Root>
		<Table.Header>
			<Table.Row>
				{#each columns as column}
					<Table.Head class={column.class}>{column.label}</Table.Head>
				{/each}
			</Table.Row>
		</Table.Header>
		<Table.Body>
			{#each rows as row (row.id)}
				<Table.Row>{@render cells(row)}</Table.Row>
			{/each}
		</Table.Body>
	</Table.Root>
{/if}
