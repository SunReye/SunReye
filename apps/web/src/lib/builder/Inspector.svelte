<!--
  The builder's glass inspector (ADR 20): the drill-in's look, one level at a time. A deeper level
  slides in from the right while the one it leaves shifts left and fades; back reverses it.
-->
<script lang="ts">
  import type { Snippet } from "svelte";
  import ChevronLeft from "@lucide/svelte/icons/chevron-left";
  import { Button } from "#lib/components/ui/button/index.js";
  import { shiftAside, slideIn } from "../motion/slide.ts";
  import Editor from "./Editor.svelte";
  import { depth, parent, type Level } from "./levels.ts";
  import { title } from "./outline.ts";
  import SaveBar from "./SaveBar.svelte";
  import StringsLevel from "./StringsLevel.svelte";
  import type { Session } from "./session.svelte.ts";

  let {
    session,
    check,
  }: {
    session: Session;
    /** What the strings' group shows under its rows. */
    check: Snippet;
  } = $props();

  const level = $derived(session.level);

  /** A level's name, in its header and on its children's back button. */
  const named = (at: Level): string => title(at, session.plan);

  function go(at: Level): void {
    session.go(at);
  }

  // The depth last shown: a deeper level enters from the right, a shallower one from the left.
  // svelte-ignore state_referenced_locally
  let shown = depth(level);

  const forward = $derived.by(() => {
    const next = depth(level);
    const deeper = next >= shown;

    shown = next;

    return deeper;
  });

  /** In from the right going deeper, from the left going back; out the other way. */
  function shift(node: Element, { entering }: { entering: boolean }) {
    return forward === entering ? slideIn(node, 1) : shiftAside(node);
  }

  const key = $derived(JSON.stringify(level));
</script>

<div class="flex h-full min-h-0 flex-col">
  <header class="relative flex min-h-12 items-center border-b border-border/60 p-1.5">
    {#if level.kind === "root"}
      <h2 class="px-2.5 text-[15px] font-semibold">{named(level)}</h2>
    {:else}
      {@const up = parent(level)}
      <Button
        variant="ghost"
        size="sm"
        onclick={() => {
          go(up);
        }}
        class="text-brand"
      >
        <ChevronLeft data-icon="inline-start" />
        {named(up)}
      </Button>
      <h2 class="ml-auto truncate px-2.5 text-[15px] font-semibold">{named(level)}</h2>
    {/if}
  </header>

  <div class="grid min-h-0 flex-1 overflow-x-hidden overflow-y-auto scroll-fade-y">
    {#key key}
      <section
        class="col-start-1 row-start-1 flex flex-col"
        aria-label={named(level)}
        in:shift={{ entering: true }}
        out:shift={{ entering: false }}
      >
        {#if level.kind === "section" && level.section === "strings"}
          <StringsLevel {session} />
          {@render check()}
        {:else}
          <Editor
            plan={session.plan}
            moduleTypes={session.moduleTypes}
            types={session}
            {level}
            onlevel={go}
            onchange={(draft) => {
              session.change(draft);
            }}
          />
        {/if}
      </section>
    {/key}
  </div>

  <footer class="border-t border-border/60 p-3">
    <SaveBar {session} />
  </footer>
</div>
