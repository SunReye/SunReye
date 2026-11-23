<script lang="ts">
  import type { Layout, Problem } from "../api/core.ts";
  import ProblemAlert from "../components/problem-alert.svelte";
  import { m } from "../paraglide/messages.js";
  import { misplacedText } from "./checks.ts";
  import type { Misplaced } from "@sunreye/builder/builder/pv.ts";

  let {
    misplaced,
    saved,
  }: {
    /** What the core would refuse, as the crate in the browser finds it. */
    misplaced: Misplaced | null;
    /** The last save's answer. */
    saved: Layout | Problem | undefined;
  } = $props();

  function name(layout: Layout, id: number): string {
    return layout.strings.find((string) => string.id === id)?.name ?? String(id);
  }
</script>

{#if misplaced !== null}
  <div class="mb-2"><ProblemAlert text={misplacedText(misplaced)} /></div>
{/if}
{#if saved !== undefined}
  {#if "problem" in saved}
    <div class="mb-2"><ProblemAlert problem={saved.problem} /></div>
  {:else}
    <!-- A warning, never a refusal: the plant may already exist (ADR 20). -->
    {#each saved.warnings as warning (warning.string)}
      <p role="alert" class="mb-2 text-sm text-warning">
        {m.builder_cold_voltage({
          name: name(saved, warning.string),
          voltage: Math.round(warning.openCircuitVoltage),
          limit: Math.round(warning.maxInputVoltage),
        })}
      </p>
    {/each}
  {/if}
{/if}
