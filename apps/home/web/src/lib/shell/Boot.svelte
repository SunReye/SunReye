<!--
  What the root shows while it checks sign-in, setup and devices: the backdrop and the brand mark,
  no dashboard skeleton that may turn out to be sign-in. As the scene's stand-in does, a quiet line
  appears only once the check takes longer than a moment, in a place held from the start.
-->
<script lang="ts">
  import SunMark from "../components/sun-mark.svelte";
  import { m } from "../paraglide/messages.js";

  /** How long the check may take before the line says why the screen waits. */
  const QUIET = 300;

  let slow = $state(false);

  $effect(() => {
    const timer = setTimeout(() => (slow = true), QUIET);

    return () => clearTimeout(timer);
  });
</script>

<main class="grid min-h-dvh place-items-center px-4 py-10" aria-busy="true">
  <div class="flex flex-col items-center gap-4">
    <SunMark class="size-10" />
    <p
      class={[
        "h-4 text-xs leading-4 text-muted-foreground transition-opacity duration-(--motion-base)",
        slow ? "opacity-100" : "opacity-0",
      ]}
      role="status"
    >
      {#if slow}{m.boot_connecting()}{/if}
    </p>
  </div>
</main>
