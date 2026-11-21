<!--
  The builder's glass inspector (ADR 20): the drill-in's look, one level at a time, each level
  pushed on the drill-in's push under the drill-in's header.
-->
<script lang="ts">
  import type { Snippet } from "svelte";
  import DrillHeader from "../components/drill-in/drill-header.svelte";
  import DrillPush from "../components/drill-in/drill-push.svelte";
  import Editor from "./Editor.svelte";
  import { depth, parent, type Level } from "./levels.ts";
  import { title, type Plan } from "./outline.ts";
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

  function go(at: Level): void {
    session.go(at);
  }

  /** Each level by its key, so one sliding away still draws as it was. */
  const levels = new Map<string, Level>();

  function keyOf(at: Level): string {
    const key = JSON.stringify(at);

    levels.set(key, at);

    return key;
  }

  const key = $derived(keyOf(level));
  const up = $derived(level.kind === "root" ? null : keyOf(parent(level)));

  // The plan each level last showed: one sliding away stays as it was, as a removed object's
  // index would otherwise name its neighbour.
  const plans = new Map<string, Plan>();

  $effect.pre(() => {
    plans.set(key, session.plan);
  });
</script>

<div class="flex h-full min-h-0 flex-col">
  <DrillPush
    at={key}
    depth={depth(level)}
    {up}
    onback={() => {
      go(parent(level));
    }}
    class="min-h-0 flex-1 grid-rows-[minmax(0,1fr)]"
  >
    {#snippet children(shown)}
      {@const at = levels.get(shown) ?? level}
      {@const plan = shown === key ? session.plan : (plans.get(shown) ?? session.plan)}
      <DrillHeader
        back={at.kind === "root" ? undefined : title(parent(at), plan)}
        title={title(at, plan)}
        onback={() => {
          go(parent(at));
        }}
      />
      <section class="flex min-h-0 flex-1 flex-col overflow-y-auto scroll-fade-y" aria-label={title(at, plan)}>
        {#if at.kind === "section" && at.section === "strings"}
          <StringsLevel {session} />
          {@render check()}
        {:else}
          <Editor
            {plan}
            moduleTypes={session.moduleTypes}
            types={session}
            level={at}
            onlevel={go}
            onchange={(draft) => {
              session.change(draft);
            }}
          />
        {/if}
      </section>
    {/snippet}
  </DrillPush>

  <footer class="border-t border-border/60 p-3">
    <SaveBar {session} />
  </footer>
</div>
