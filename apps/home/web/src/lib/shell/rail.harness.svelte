<!-- Test harness: the rail with the tooltips' provider the shell gives it. -->
<script lang="ts">
  import * as Tooltip from "#lib/components/ui/tooltip/index.js";
  import Rail from "./Rail.svelte";
</script>

<Tooltip.Provider>
  <Rail touch={false} current={null} admin={false} />
</Tooltip.Provider>
