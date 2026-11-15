<!-- A string's flag as an icon: a warning for a weak string, a hint for a face that leans. -->
<script lang="ts">
  import Info from "@lucide/svelte/icons/info";
  import TriangleAlert from "@lucide/svelte/icons/triangle-alert";
  import { m } from "../paraglide/messages.js";
  import type { StringRow } from "./strings.ts";

  let {
    flag,
    label,
  }: {
    flag: StringRow["flag"];
    /** Named, where no text beside it says it. */
    label: boolean;
  } = $props();
</script>

{#if flag === "weak"}<TriangleAlert
    class="mt-0.5 size-4 shrink-0 text-warning"
    aria-label={label ? m.strings_warning() : undefined}
  />{:else if flag === "face"}<Info
    class="mt-0.5 size-4 shrink-0 text-muted-foreground"
    aria-label={label ? m.strings_hint() : undefined}
  />{/if}
