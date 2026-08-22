<script lang="ts">
	import { RangeCalendar as RangeCalendarPrimitive } from "bits-ui";
	import { cn } from "$lib/utils.js";

	let {
		ref = $bindable(null),
		class: className,
		...restProps
	}: RangeCalendarPrimitive.DayProps = $props();
</script>

<RangeCalendarPrimitive.Day
	bind:ref
	class={cn(
		"flex h-(--cell-size) w-full flex-col items-center justify-center gap-1 rounded-(--cell-radius) p-0 leading-none font-normal whitespace-nowrap select-none",
		"not-data-selected:hover:bg-accent/50 not-data-selected:hover:text-accent-foreground",
		// Today: a ringed, muted cell — never a filled one. Upstream shadcn paints
		// today with `bg-accent`, which is right for upstream's palette and wrong
		// for ours: `app.css` sets `--accent` byte-identical to `--primary` in
		// `:root` AND in `.dark`, so today rendered pixel-for-pixel as a range
		// endpoint and a one-day pick on /statistics read as a two-day range.
		// Fixed here rather than in `app.css` because `--accent` is spent as a
		// hover/muted surface by about a dozen other components.
		// Pinned by `src/lib/components/ui/calendar-marker-tokens.test.ts` and
		// `e2e/range-picker-selection.spec.ts` — this file is vendored, and a
		// future `shadcn-svelte add` would otherwise restore the collision.
		"[&[data-today]:not([data-selected])]:bg-muted [&[data-today]:not([data-selected])]:text-foreground [&[data-today]:not([data-selected])]:inset-ring-2 [&[data-today]:not([data-selected])]:inset-ring-primary",
		"[&[data-today][data-disabled]]:text-muted-foreground data-[range-middle]:rounded-none",
		// range Start
		"data-[range-start]:bg-primary data-[range-start]:text-primary-foreground data-[range-start]:hover:text-foreground",
		// range End
		"data-[range-end]:bg-primary data-[range-end]:text-primary-foreground data-[range-end]:hover:text-foreground",
		// Outside months
		"[&[data-outside-month]:not([data-selected])]:text-muted-foreground [&[data-outside-month]:not([data-selected])]:hover:text-accent-foreground",
		// Disabled
		"data-[disabled]:text-muted-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
		// Unavailable
		"data-[unavailable]:line-through",
		"dark:data-[range-middle]:hover:bg-accent/0",
		// focus
		"focus:border-ring focus:ring-ring/50 focus:relative",
		// inner spans
		"[&>span]:text-xs [&>span]:opacity-70",
		className
	)}
	{...restProps}
/>
