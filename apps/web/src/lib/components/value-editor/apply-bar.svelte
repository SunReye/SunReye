<!-- The editor's apply, "Apply 100 A → 80 A", and the problem an apply left (ADR 21). -->
<script lang="ts">
  import ArrowRight from "@lucide/svelte/icons/arrow-right";
  import { Button } from "#lib/components/ui/button/index.js";
  import { Spinner } from "#lib/components/ui/spinner/index.js";
  import { m } from "../../paraglide/messages.js";
  import type { Outcome } from "./editable.ts";
  import WriteProblem from "./write-problem.svelte";

  let {
    nowText,
    nextText,
    changed,
    pending,
    done,
    problem,
    allowed,
    onapply,
  }: {
    /** The device's value as text; empty when unknown. */
    nowText: string;
    nextText: string;
    changed: boolean;
    pending: boolean;
    done: boolean;
    problem: Exclude<Outcome, { kind: "confirmed" }> | undefined;
    /** Whether the core's funnel would take the new value. */
    allowed: boolean;
    onapply: () => void;
  } = $props();

  const disabled = $derived(!changed || pending || done || problem !== undefined || !allowed);

  /** The label's parts: lead text, the old value, an arrow, the new value. */
  const label = $derived.by(() => {
    if (pending) return { lead: m.editor_pending(), from: "", arrow: false, to: nextText };

    if (!changed)
      return {
        lead: done ? m.editor_confirmed() : m.editor_unchanged(),
        from: "",
        arrow: false,
        to: "",
      };

    // Both values fit on one line up to about 16 characters; past that only the new one shows.
    const from = nowText !== "" && (nowText + nextText).length <= 16 ? nowText : "";

    return { lead: m.editor_apply(), from, arrow: true, to: nextText };
  });
</script>

{#if problem}
  <WriteProblem {problem} />
{/if}

<Button size="lg" class="h-11 w-full text-[15px]" {disabled} onclick={onapply}>
  {#if pending}<Spinner aria-hidden="true" />{/if}
  {label.lead}
  {#if label.from}<span class="opacity-70">{label.from}</span>{/if}
  {#if label.arrow}<ArrowRight class="size-4 opacity-70" />{/if}
  {label.to}
</Button>
