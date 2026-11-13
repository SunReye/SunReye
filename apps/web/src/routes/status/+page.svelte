<script lang="ts">
  import { useCore } from "../../lib/shell/core.ts";
  import StatusScreen from "../../lib/status/StatusScreen.svelte";

  const core = useCore();
</script>

<StatusScreen {core} />
