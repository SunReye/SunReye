<!-- ADR 21's error treatment: the `error` haptic and a destructive alert beside the action, which stays for a fix. -->
<script lang="ts">
  import ProblemAlert from "../components/problem-alert.svelte";
  import type { Problem } from "../api/core.ts";
  import { haptics } from "../haptics.ts";

  let {
    refused,
    text,
  }: {
    refused?: Problem | undefined;
    /** A refusal the SPA itself makes, before asking the core; its caller plays the haptic. */
    text?: string | undefined;
  } = $props();

  // Each refusal answers once, a repeated one too: it is a new object.
  $effect(() => {
    if (refused !== undefined) haptics.error();
  });
</script>

<ProblemAlert problem={refused?.problem} {text} />
