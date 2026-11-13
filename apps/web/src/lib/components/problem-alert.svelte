<!--
  A problem said where it is fixed: the kit's destructive Alert with a core problem code in the
  app's words, or a text of the app's own. Nothing without either.
-->
<script lang="ts">
  import CircleAlert from "@lucide/svelte/icons/circle-alert";
  import { problemText } from "../i18n/problems.ts";
  import * as Alert from "./ui/alert/index.js";

  let {
    problem,
    text,
  }: {
    /** A problem code of the core (ADR 9). */
    problem?: string | undefined;
    text?: string | undefined;
  } = $props();

  const message = $derived(text ?? (problem === undefined ? undefined : problemText(problem)));
</script>

{#if message !== undefined}
  <Alert.Root variant="destructive">
    <CircleAlert />
    <Alert.Description>{message}</Alert.Description>
  </Alert.Root>
{/if}
