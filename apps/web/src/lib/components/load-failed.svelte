<!--
  The one load-failure state (ADR 21): what could not be read, and its retry, which plays `light`.
  `inline` stands in place of a panel's content, `block` in place of a whole card, `quiet` is one
  line beside a figure the failure leaves standing.
-->
<script lang="ts">
  import TriangleAlert from "@lucide/svelte/icons/triangle-alert";
  import { Button } from "#lib/components/ui/button/index.js";
  import { Pressable } from "#lib/components/ui/pressable/index.js";
  import { haptics } from "../haptics.ts";
  import { m } from "../paraglide/messages.js";

  let {
    text,
    detail,
    size = "inline",
    class: className = "",
    onretry,
  }: {
    /** What could not be read. */
    text: string;
    /** Under a block's heading: what still works, or why. */
    detail?: string | undefined;
    size?: "inline" | "block" | "quiet";
    class?: string;
    onretry: () => void;
  } = $props();

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
    {#if detail}<p class="max-w-[52ch] text-sm text-muted-foreground">{detail}</p>{/if}
    <Button onclick={retry}>{m.stats_retry()}</Button>
  </div>
{:else}
  <div class={["flex flex-col items-start gap-3 py-6", className]} role="alert">
    <p class="flex items-center gap-2 text-sm">
      <TriangleAlert class="size-4 shrink-0 text-warning" />
      {text}
    </p>
    <Button variant="outline" size="sm" onclick={retry}>{m.stats_retry()}</Button>
  </div>
{/if}
