<script lang="ts">
  import { page } from "$app/state";
  import ErrorScreen from "../lib/shell/ErrorScreen.svelte";
</script>

<ErrorScreen
  status={page.status}
  message={page.error?.message ?? ""}
  reload={() => location.reload()}
/>
