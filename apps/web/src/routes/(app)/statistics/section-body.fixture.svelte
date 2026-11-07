<script lang="ts">
	// Test-only stand-in for `section-body.svelte`: the section list's gate is
	// what is under test, not the bodies it would mount. Used by
	// `section-list.svelte.test.ts` through `vi.mock`.
	let { id }: { id: string } = $props();
</script>

<p>body:{id}</p>
