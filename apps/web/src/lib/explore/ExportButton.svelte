<!-- The plotted points as a CSV (ADR 22); nothing drawn, nothing to export. -->
<script lang="ts">
  import Download from "@lucide/svelte/icons/download";
  import { Button } from "@sunreye/ui/button";
  import { m } from "../paraglide/messages.js";
  import type { Table } from "./csv.ts";
  import { save } from "./save.ts";

  let { table }: { table: Table | null } = $props();
</script>

<Button
  variant="outline"
  size="icon-sm"
  aria-label={m.explore_export()}
  title={m.explore_export()}
  disabled={table === null}
  onclick={() => {
    if (table) save(table);
  }}
>
  <Download />
</Button>
