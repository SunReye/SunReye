<!-- The 3D scene's camera lock (ADR 20): pressed, the camera orbits and zooms. -->
<script lang="ts">
  import Lock from "@lucide/svelte/icons/lock";
  import LockOpen from "@lucide/svelte/icons/lock-open";
  import { Toggle } from "#lib/components/ui/toggle/index.js";
  import { haptics } from "../haptics.ts";
  import { m } from "../paraglide/messages.js";

  let { locked = $bindable() }: { locked: boolean } = $props();
</script>

<Toggle
  size="sm"
  bind:pressed={
    () => !locked,
    (moving) => {
      haptics.selection();
      locked = !moving;
    }
  }
  class="canvas-chip size-9 ring-1 ring-border/60 elevation-1"
  aria-label={m.dash_camera_move()}
  title={m.dash_camera_move()}
>
  {#if locked}<Lock />{:else}<LockOpen />{/if}
</Toggle>
