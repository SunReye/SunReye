<!-- Asks a saved view's name (ADR 22), as it is saved or renamed: the form overlay of ADR 21. -->
<script lang="ts">
  import type { Problem } from "../api/client.ts";
  import { ResponsiveSheet } from "@sunreye/builder/controls";
  import ViewNameForm from "./ViewNameForm.svelte";

  let {
    open = $bindable(false),
    title,
    name,
    onsubmit,
  }: {
    open?: boolean;
    title: string;
    /** The name the form opens with. */
    name: string;
    onsubmit: (name: string) => Promise<Problem | undefined>;
  } = $props();
</script>

<ResponsiveSheet bind:open label={title} titled>
  {#if open}
    <ViewNameForm {name} {onsubmit} onclose={() => (open = false)} />
  {/if}
</ResponsiveSheet>
