<script lang="ts">
	import { CHART_HOUSE_STYLE } from './chart-house-style.js';

	// A canvas mark has no element to style, so layerchart resolves its classes
	// on ONE hidden <svg> found by this id — created after whichever canvas draws
	// first, and inheriting from THERE. Left to that, the axis size, weight and
	// dark-mode halo of every canvas chart on a page depended on whether the
	// first chart to mount sat inside a `Chart.Container` (12px, house look) or
	// not (layerchart's 10px). Mounted once at the root, this owns the resolver
	// under the house style so the answer is always the same. An attachment, not
	// an `$effect`: it runs as the element is created, ahead of any chart's own
	// effects, so no style is resolved (and memoised) before it moves in.
	const RESOLVER_ID = '__layerchart_canvas_styles_id';

	function ownResolver(host: HTMLElement) {
		let resolver: HTMLElement | SVGElement | null = document.getElementById(RESOLVER_ID);
		if (!resolver) {
			resolver = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
			resolver.id = RESOLVER_ID;
			resolver.style.display = 'none';
		}
		host.append(resolver);
	}
</script>

<div {@attach ownResolver} class={CHART_HOUSE_STYLE} hidden aria-hidden="true"></div>
