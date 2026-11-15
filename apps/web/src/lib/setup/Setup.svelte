<!--
  The first run (ADR 11, 21) on the drill-in: one level per step, the next one opening as each is
  done; back lists the steps and how far setup has come. The PV layout step fills the screen.
-->
<script lang="ts">
  import { MediaQuery } from "svelte/reactivity";
  import type { Core, Device } from "../api/core.ts";
  import DrillIn from "../components/drill-in/drill-in.svelte";
  import { m } from "../paraglide/messages.js";
  import { getLocale } from "../paraglide/runtime.js";
  import LayoutStep from "./LayoutStep.svelte";
  import SetupHeading from "./SetupHeading.svelte";
  import StepPage from "./StepPage.svelte";
  import { isStep, stepGroups, steps, type Step } from "./steps.ts";

  let {
    core,
    signedIn,
    onfinish,
  }: {
    core: Core;
    /** Signed in already, as under Home Assistant ingress: no password to set. */
    signedIn: boolean;
    onfinish: () => void;
  } = $props();

  // Chosen once: signing in on the way does not add or drop a step.
  // svelte-ignore state_referenced_locally
  const list = steps(signedIn);

  /** The index of the step to run next. */
  let next = $state(0);

  /** The open level; setup opens on its first step. */
  let open = $state<Step | null>(list[0] ?? null);

  let devices = $state.raw<readonly Device[]>([]);

  let locale = $state(getLocale());

  // Two panes always show a step: the next one when no level is open.
  const split = new MediaQuery("(min-width: 1024px)");

  const shown = $derived(open ?? (split.current ? (list[next] ?? null) : null));

  const groups = $derived.by(() => {
    // Labels are messages: read again on a new language.
    void locale;

    return stepGroups(list, next);
  });

  function navigate(id: string | null): void {
    if (id === null) open = null;
    else if (isStep(id) && id === list[next]) open = id;
  }

  function done(added?: readonly Device[]): void {
    if (added !== undefined) devices = added;

    next += 1;
    open = list[next] ?? null;
  }
</script>

{#snippet heading()}
  <SetupHeading bind:locale step={next + 1} count={list.length} />
{/snippet}

<!-- Messages are no state: a new locale renders the step anew; the step itself is kept. -->
{#key locale}
  {#if shown === "layout"}
    <LayoutStep
      {core}
      {devices}
      step={next + 1}
      count={list.length}
      onback={() => {
        open = null;
      }}
      ondone={onfinish}
    />
  {:else}
    <main class="mx-auto block w-full max-w-5xl lg:px-6">
      <DrillIn
        {groups}
        open={shown}
        onnavigate={navigate}
        back={m.setup_title()}
        label={m.setup_steps()}
        {heading}
      >
        {#snippet page(group)}
          {#if isStep(group.id)}
            <StepPage {core} step={group.id} {devices} ondone={done} />
          {/if}
        {/snippet}
      </DrillIn>
    </main>
  {/if}
{/key}
