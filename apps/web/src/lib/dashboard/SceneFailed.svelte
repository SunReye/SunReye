<!-- Quiet, beside the figure it does not change: the 3D scene failed to load, the flow below serves. -->
<script lang="ts">
  import { Pressable } from "../components/ui/pressable/index.js";
  import { m } from "../paraglide/messages.js";

  let { onretry }: { onretry: () => void } = $props();
</script>

<span
  class="pointer-events-auto mt-1.5 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground"
  role="status"
>
  {m.dash_scene_failed()}
  <Pressable class="rounded-sm font-medium text-brand hover:underline" onclick={onretry}>
    {m.dash_scene_retry()}
  </Pressable>
</span>
