<!--
  A problem said where it is fixed (ADR 21): the kit's destructive Alert with a text already in the
  reader's words. Nothing without one.
-->
<script lang="ts">
  import CircleAlert from "@lucide/svelte/icons/circle-alert";
  import * as Alert from "@sunreye/ui/alert";

  let { text }: { text?: string | undefined } = $props();
</script>

{#if text !== undefined}
  <Alert.Root variant="destructive">
    <CircleAlert />
    <Alert.Description>{text}</Alert.Description>
  </Alert.Root>
{/if}
