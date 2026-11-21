<!--
  The one load-failure state (ADR 21): what could not be read, and its retry, which plays `light`.
  `inline` stands in place of a panel's content, `block` in place of a whole card, `quiet` is one
  line beside a figure the failure leaves standing. A read the core refused says the core's reason,
  in place of a block's detail; `quiet` stands beside a figure, not a read.
-->
<script lang="ts">
  import TriangleAlert from "@lucide/svelte/icons/triangle-alert";
  import { Button } from "#lib/components/ui/button/index.js";
  import { Pressable } from "#lib/components/ui/pressable/index.js";
  import type { Problem } from "../api/client.ts";
  import { haptics } from "../haptics.ts";
  import { problemText } from "../i18n/problems.ts";
  import { m } from "../paraglide/messages.js";

  let {
    text,
    detail,
    refused,
    size = "inline",
    class: className = "",
    onretry,
  }: {
    /** What could not be read. */
    text: string;
    /** Under a block's heading: what still works, or why. */
    detail?: string | undefined;
    /** Why the core refused the read; none for a lost core. */
    refused?: Problem | undefined;
    size?: "inline" | "block" | "quiet";
    class?: string;
    onretry: () => void;
  } = $props();

  const reason = $derived(refused === undefined ? undefined : problemText(refused.problem));

  /** Under a block's heading: the core's reason, else the caller's detail. */
  const note = $derived(reason ?? detail);

  function retry(): void {
    haptics.light();
    onretry();
  }
</script>

{#if size === "quiet"}
  <span
    class={["flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground", className]}
    role="status"
  >
    <span>{text}</span>
    <Pressable class="rounded-sm font-medium text-brand hover:underline" onclick={retry}>
      {m.stats_retry()}
    </Pressable>
  </span>
{:else if size === "block"}
  <div
    class={[
      "flex min-h-[420px] flex-col items-start justify-center gap-3 px-5 py-8 sm:px-8",
      className,
    ]}
    role="alert"
  >
    <TriangleAlert class="size-5 text-warning" />
    <h2 class="text-base font-semibold">{text}</h2>
    {#if note}<p class="max-w-[52ch] text-sm text-muted-foreground">{note}</p>{/if}
    <Button onclick={retry}>{m.stats_retry()}</Button>
  </div>
{:else}
  <div class={["flex flex-col items-start gap-3 py-6", className]} role="alert">
    <p class="flex items-center gap-2 text-sm">
      <TriangleAlert class="size-4 shrink-0 text-warning" />
      {text}
    </p>
    {#if reason}<p class="text-xs text-muted-foreground">{reason}</p>{/if}
    <Button variant="outline" size="sm" onclick={retry}>{m.stats_retry()}</Button>
  </div>
{/if}
