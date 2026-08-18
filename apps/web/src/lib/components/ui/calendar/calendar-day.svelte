<script lang="ts">
	import { cn } from "$lib/utils.js";
	import { Calendar as CalendarPrimitive } from "bits-ui";

	let {
		ref = $bindable(null),
		class: className,
		...restProps
	}: CalendarPrimitive.DayProps = $props();
</script>

<CalendarPrimitive.Day
	bind:ref
	class={cn(
		"flex size-(--cell-size) flex-col items-center justify-center gap-1 rounded-(--cell-radius) p-0 leading-none font-normal whitespace-nowrap select-none",
		"[&:last-child[data-selected=true]_button]:rounded-r-(--cell-radius)",
		"not-data-selected:hover:bg-accent/50 not-data-selected:hover:text-accent-foreground",
		// Today: a ringed, muted cell — never a filled one. Same collision as the
		// range calendar (see `range-calendar/range-calendar-day.svelte`):
		// `--accent` is byte-identical to `--primary` in both themes, so upstream's
		// `bg-accent` made today indistinguishable from the picked day.
		"[&[data-today]:not([data-selected])]:bg-muted [&[data-today]:not([data-selected])]:text-foreground [&[data-today]:not([data-selected])]:inset-ring-2 [&[data-today]:not([data-selected])]:inset-ring-primary",
		"[&[data-today][data-disabled]]:text-muted-foreground",
		"data-[selected]:bg-primary data-[selected]:text-primary-foreground data-[selected]:hover:text-foreground",
		// Outside months
		"[&[data-outside-month]:not([data-selected])]:text-muted-foreground [&[data-outside-month]:not([data-selected])]:hover:text-accent-foreground",
		// Disabled
		"data-[disabled]:text-muted-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
		// Unavailable
		"data-[unavailable]:text-muted-foreground data-[unavailable]:line-through",
		// focus
		"focus:border-ring focus:ring-ring/50 focus:relative",
		// inner spans
		"[&>span]:text-xs [&>span]:opacity-70",
		className
	)}
	{...restProps}
/>
