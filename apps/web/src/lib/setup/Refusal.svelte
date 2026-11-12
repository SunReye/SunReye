<!-- ADR 21's error treatment: the `error` haptic and a destructive alert beside the action, which stays for a fix. -->
<script lang="ts">
  import CircleAlert from "@lucide/svelte/icons/circle-alert";
  import type { Problem } from "../api/core.ts";
  import { haptics } from "../haptics.ts";
  import { problemText } from "../i18n/problems";

  let {
    refused,
    text,
  }: {
    refused?: Problem | undefined;
    /** A refusal the SPA itself makes, before asking the core; its caller plays the haptic. */
    text?: string | undefined;
  } = $props();

  const message = $derived(
    text ?? (refused === undefined ? undefined : problemText(refused.problem)),
  );

  // Each refusal answers once, a repeated one too: it is a new object.
  $effect(() => {
    if (refused !== undefined) haptics.error();
  });
</script>

{#if message !== undefined}
  <div
    role="alert"
    class="flex items-start gap-2.5 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2.5 text-sm"
  >
    <CircleAlert class="mt-0.5 size-4 shrink-0 text-destructive" />
    <p class="flex-1">{message}</p>
  </div>
{/if}
