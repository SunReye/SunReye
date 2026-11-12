<!-- The range could not be read: what happened, and the way out. The range and view stay. -->
<script lang="ts">
  import TriangleAlert from "@lucide/svelte/icons/triangle-alert";
  import { Button } from "#lib/components/ui/button/index.js";
  import { haptics } from "../haptics.ts";
  import { m } from "../paraglide/messages.js";

  let { onretry }: { onretry: () => void } = $props();
</script>

<div
  class="flex min-h-[420px] flex-col items-start justify-center gap-3 px-5 py-8 sm:px-8"
  role="alert"
>
  <TriangleAlert class="size-5 text-warning" />
  <h2 class="text-base font-semibold">{m.stats_error_title()}</h2>
  <p class="max-w-[52ch] text-sm text-muted-foreground">{m.stats_error_text()}</p>
  <Button
    onclick={() => {
      haptics.light();
      onretry();
    }}>{m.stats_retry()}</Button
  >
</div>
