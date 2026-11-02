<script lang="ts">
	import * as Sidebar from '$lib/components/ui/sidebar';
	import AppSidebar from './app-sidebar.svelte';
</script>

<Sidebar.Provider>
	<Sidebar.Trigger />
	<AppSidebar />
</Sidebar.Provider>
