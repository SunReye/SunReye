<!-- The Strings group (ADR 20): each inverter, its MPPT inputs and the strings on each, every
  warning beside what it judges; the modules in no string, one tap from a selection. -->
<script lang="ts">
  import ChevronRight from "@lucide/svelte/icons/chevron-right";
  import { Button } from "#lib/components/ui/button/index.js";
  import { Pressable } from "../components/ui/pressable/index.js";
  import { m } from "../paraglide/messages.js";
  import AddButtons from "./AddButtons.svelte";
  import { additions } from "./additions.ts";
  import { painted } from "./modules.ts";
  import { stringCss } from "./scene.ts";
  import type { Session } from "./session.svelte.ts";
  import { stringTree } from "./string-tree.ts";

  let { session }: { session: Session } = $props();

  const uid = $props.id();

  const plan = $derived(session.plan);
  const draft = $derived(plan.draft);

  const tree = $derived(
    stringTree({
      strings: draft.strings,
      devices: plan.devices,
      inputs: plan.inputs,
      warnings: [...plan.cold, ...plan.sized],
    }),
  );

  const unwired = $derived(session.wiring.unwired);
  const adds = $derived(additions("strings", plan, session.moduleTypes[0]?.id));
</script>

{#each tree as inverter (inverter.device)}
  <div role="group" aria-labelledby="{uid}-{inverter.device}" class="border-b border-border/60">
    <h3 id="{uid}-{inverter.device}" class="px-4 pt-3 pb-1 text-[15px] font-semibold">
      {inverter.name}
    </h3>
    {#each inverter.inputs as input (input.input)}
      {@const heading = `${uid}-${inverter.device}-${input.input}`}
      <div role="group" aria-labelledby={heading} class="pb-1">
        <h4 id={heading} class="px-4 pt-2 text-xs font-medium text-muted-foreground">
          {m.builder_input({ input: input.input })}
        </h4>
        {#each input.strings as { index, warnings } (index)}
          {@const string = draft.strings[index]}
          <Pressable
            feedback
            class="flex min-h-12 w-full items-center gap-3 px-4 py-1.5 text-left"
            onclick={() => {
              session.go({ kind: "string", index });
            }}
          >
            <span class="size-3 shrink-0 rounded-sm" style:background={stringCss(index)}></span>
            <span class="flex min-w-0 flex-1 flex-col">
              <span class="truncate text-[15px] font-medium">{string?.name}</span>
              <span class="truncate text-sm text-muted-foreground tabular-nums">
                {m.builder_string_modules(painted(draft.scene, index))}
              </span>
            </span>
            <ChevronRight class="size-4 shrink-0 text-muted-foreground" />
          </Pressable>
          {#each warnings as warning (warning)}
            <p role="status" class="px-4 pb-1.5 pl-10 text-sm text-warning">{warning}</p>
          {/each}
        {:else}
          <p class="px-4 py-1.5 text-sm text-muted-foreground">{m.builder_input_free()}</p>
        {/each}
        {#each input.warnings as warning (warning)}
          <p role="status" class="px-4 pb-1.5 text-sm text-warning">{warning}</p>
        {/each}
      </div>
    {/each}
  </div>
{/each}

{#if session.wiring.proposed !== undefined}
  <!-- Auto-stringing's result, listed above and drawn on the roof until it is kept or dropped. -->
  <div class="flex flex-col gap-2 p-3">
    <p role="status" class="text-sm font-medium">
      {m.builder_proposal({ count: session.wiring.proposed })}
    </p>
    <div class="grid grid-cols-2 gap-2">
      <Button
        variant="outline"
        class="min-h-11"
        onclick={() => {
          session.wiring.discard();
        }}>{m.builder_discard()}</Button
      >
      <Button
        class="min-h-11"
        onclick={() => {
          session.wiring.keep();
        }}>{m.builder_keep()}</Button
      >
    </div>
  </div>
{:else}
  <div class="flex flex-col gap-2 p-3">
    {#if unwired.length > 0}
      <Button
        variant="outline"
        class="min-h-11 justify-start"
        aria-label={m.builder_unwired_select({ count: unwired.length })}
        onclick={() => {
          session.wiring.select(unwired);
        }}
      >
        {m.builder_unwired_count({ count: unwired.length })}
      </Button>
    {/if}
    {#each session.wiring.loose as { grid, face, count } (grid)}
      <Button
        variant="outline"
        class="h-auto min-h-11 justify-start text-left whitespace-normal"
        onclick={() => {
          session.wiring.auto(grid);
        }}
      >
        {m.builder_auto_string({ face, count })}
      </Button>
    {/each}
    <p class="text-sm text-muted-foreground">{m.builder_string_hint()}</p>
  </div>

  <AddButtons
    {adds}
    onchange={(next) => {
      session.change(next);
    }}
    onlevel={(level) => {
      session.go(level);
    }}
  />
{/if}
