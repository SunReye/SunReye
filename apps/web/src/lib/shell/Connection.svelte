<!--
  The connection chip (ADR 21): quiet while live, loud when the stream stalls or drops. In the rail
  it is a dot with a label; as a strip it sits above a screen, covering nothing.
-->
<script lang="ts">
  import { stream } from "../live/stream.svelte.ts";
  import { age } from "../live/stream.ts";
  import { m } from "../paraglide/messages.js";

  /** `strip`: a strip above the screen instead of the rail's row. */
  let { strip = false }: { strip?: boolean } = $props();

  let now = $state(Date.now());

  // The age counts up between frames.
  $effect(() => {
    const timer = setInterval(() => (now = Date.now()), 1000);

    return () => {
      clearInterval(timer);
    };
  });

  const chip = $derived.by(() => {
    const current = stream.state;

    switch (current.kind) {
      case "live":
        return {
          dot: "bg-success text-success animate-pulse-dot motion-reduce:animate-none",
          text: m.conn_live({ age: age(stream.at, Math.max(now, stream.at)) }),
          loud: false,
        };
      case "connecting":
        return { dot: "bg-muted-foreground", text: m.conn_connecting(), loud: false };
      case "stalled":
        return {
          dot: "bg-warning",
          text: m.conn_stalled({ age: age(current.since, now) }),
          loud: true,
        };
      case "lost":
        return { dot: "bg-destructive", text: m.conn_lost(), loud: true };
    }
  });
</script>

{#if strip}
  <div
    class="mx-auto mt-3 flex w-fit items-center gap-2 rounded-md border border-border/60 px-3 py-1.5 text-xs font-medium"
    role="status"
  >
    <span class={["size-2 rounded-full", chip.dot]}></span>{chip.text}
  </div>
{:else}
  <span
    class="grid size-8 shrink-0 place-items-center"
    title={chip.text}
    role="status"
    aria-label={chip.text}
  >
    <span class={["size-2 rounded-full", chip.dot]}></span>
  </span>
  <span
    class={[
      "label truncate text-xs",
      chip.loud ? "font-medium text-foreground" : "text-muted-foreground",
    ]}>{chip.text}</span
  >
{/if}
