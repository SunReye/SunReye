<!--
  One reading: its label, its age once stale, its value. A reading with stored history opens
  Explore on its series (ADR 22); one that is a node opens its sheet by its name, and Explore by
  its value.
-->
<script lang="ts">
  import { FEEDBACK_WITHIN, Pressable } from "@sunreye/ui/pressable";
  import ChevronRight from "@lucide/svelte/icons/chevron-right";
  import { m } from "../paraglide/messages.js";
  import ReadingValue from "./ReadingValue.svelte";
  import { ago } from "./readings.ts";
  import type { Row } from "./rows.ts";

  let {
    row,
    loading,
    silent,
    onopen,
  }: { row: Row; loading: boolean; silent: boolean; onopen: (id: string) => void } = $props();

  const dim = $derived(silent || row.age !== undefined);
  const to = $derived(row.to);
  const href = $derived(row.href);

  /** The row's one target covers it: the label names it, the whole row takes the pointer. */
  const COVER =
    "outline-none after:absolute after:inset-0 after:rounded-sm focus-visible:after:ring-2 focus-visible:after:ring-ring focus-visible:after:ring-inset";

  const PRESSED = [
    "group relative -mx-2 flex items-baseline gap-2 rounded-sm px-2 py-2 transition-colors",
    FEEDBACK_WITHIN,
  ];
</script>

{#snippet label()}
  <!-- Two lines before an ellipsis: a long name differs from its neighbour's at its end. -->
  <span class="line-clamp-2 min-w-0 break-words text-muted-foreground">{row.label}</span>
{/snippet}

{#snippet age()}
  {#if row.age !== undefined && !silent}
    <span class="shrink-0 text-xs text-warning">{ago(row.age)}</span>
  {/if}
{/snippet}

{#snippet chevron()}
  <ChevronRight
    class="size-3.5 shrink-0 self-center text-muted-foreground transition-transform group-hover:translate-x-0.5"
  />
{/snippet}

{#if to === undefined && href === undefined}
  <div class="flex items-baseline gap-2 py-2">
    <dt class="flex min-w-0 flex-1 items-baseline gap-2">{@render label()}{@render age()}</dt>
    <dd><ReadingValue {row} {loading} {dim} /></dd>
  </div>
{:else if to === undefined}
  <div class={PRESSED}>
    <dt class="flex min-w-0 flex-1 items-baseline gap-2">
      <a {href} class={["flex min-w-0", COVER]}>{@render label()}</a>{@render age()}
    </dt>
    <!-- Underlined like every value that opens Explore: touch has no hover to say so. -->
    <dd class="underline decoration-border underline-offset-4 group-hover:decoration-foreground">
      <ReadingValue {row} {loading} {dim} />
    </dd>
  </div>
{:else if href === undefined}
  <Pressable
    feedback
    class="group -mx-2 flex items-baseline gap-2 rounded-sm px-2 py-2 text-left"
    onclick={() => onopen(to)}
  >
    <dt class="flex min-w-0 flex-1 items-baseline gap-2">{@render label()}{@render age()}</dt>
    <dd class="flex items-baseline gap-1">
      <ReadingValue {row} {loading} {dim} />{@render chevron()}
    </dd>
  </Pressable>
{:else}
  <div class={PRESSED}>
    <dt class="flex min-w-0 flex-1 items-baseline gap-2">
      <Pressable class={["flex min-w-0 text-left", COVER]} onclick={() => onopen(to)}>
        {@render label()}
      </Pressable>{@render age()}
    </dt>
    <dd class="flex items-baseline gap-1">
      <!-- Above the name's cover: the value is its own target. -->
      <a
        {href}
        aria-label={m.detail_explore({ label: row.label })}
        class="relative z-10 rounded-sm underline decoration-border underline-offset-4 outline-none hover:decoration-foreground focus-visible:ring-2 focus-visible:ring-ring"
        ><ReadingValue {row} {loading} {dim} /></a
      >{@render chevron()}
    </dd>
  </div>
{/if}
