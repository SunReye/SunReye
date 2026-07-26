<script lang="ts">
	import * as Dialog from "$lib/components/ui/dialog";
	import { ScrollArea } from "$lib/components/ui/scroll-area";
	import * as Table from "$lib/components/ui/table";
	import type { TestResult } from "./inverter-types";
	import * as msg from "$lib/paraglide/messages";

	let {
		open = $bindable(false),
		result
	}: {
		open?: boolean;
		result: TestResult | null;
	} = $props();

	const description = $derived(
		msg.snapshot_desc({ count: result?.metricCount ?? 0, ms: result?.durationMs ?? 0 })
	);
	const metrics = $derived(result?.metrics ?? []);

	// Raw register reads can be long floats (e.g. -33.629999999999995); round to a
	// readable precision so the value column doesn't overflow on narrow screens.
	function fmt(n: number): string {
		if (!Number.isFinite(n)) return String(n);
		return Number.isInteger(n) ? String(n) : String(Math.round(n * 1000) / 1000);
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="sm:max-w-2xl">
		<Dialog.Header>
			<Dialog.Title>{msg.snapshot_title()}</Dialog.Title>
			<Dialog.Description>
				{description}
			</Dialog.Description>
		</Dialog.Header>
		<ScrollArea class="h-[60vh] w-full min-w-0 pr-3">
			<Table.Root>
				<Table.Header>
					<Table.Row>
						<Table.Head>{msg.snapshot_col_metric()}</Table.Head>
						<Table.Head class="hidden sm:table-cell">{msg.snapshot_col_group()}</Table.Head>
						<Table.Head class="text-right">{msg.snapshot_col_value()}</Table.Head>
					</Table.Row>
				</Table.Header>
				<Table.Body>
					{#each metrics as m (m.key)}
						<Table.Row>
							<Table.Cell class="font-medium whitespace-normal">{m.label}</Table.Cell>
							<Table.Cell class="hidden text-muted-foreground sm:table-cell">{m.group}</Table.Cell>
							<Table.Cell class="wrap-break-word text-right tabular-nums whitespace-normal">
								{#if m.display}
									{m.display}
									<span class="ml-1 text-xs text-muted-foreground">({fmt(m.value)})</span>
								{:else}
									{fmt(m.value)}{#if m.unit}&nbsp;{m.unit}{/if}
								{/if}
							</Table.Cell>
						</Table.Row>
					{/each}
				</Table.Body>
			</Table.Root>
		</ScrollArea>
	</Dialog.Content>
</Dialog.Root>
