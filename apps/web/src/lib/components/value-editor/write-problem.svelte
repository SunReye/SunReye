<!-- A refused or mismatched apply, beside its cause and linked to the write log (ADR 21). -->
<script lang="ts">
  import CircleAlert from "@lucide/svelte/icons/circle-alert";
  import { m } from "../../paraglide/messages.js";
  import type { Outcome } from "./editable.ts";

  let { problem }: { problem: Exclude<Outcome, { kind: "confirmed" }> } = $props();
</script>

<div
  class="flex items-start gap-2.5 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2.5 text-left text-sm"
  role="alert"
>
  <CircleAlert class="mt-0.5 size-4 shrink-0 text-destructive" />
  <p class="flex-1">
    <span class="font-medium"
      >{problem.kind === "refused" ? m.editor_refused() : m.editor_mismatch()}</span
    >
    {problem.reason}
    <a href="#/settings" class="whitespace-nowrap text-brand underline-offset-2 hover:underline"
      >{m.writes_log()}</a
    >
  </p>
</div>
