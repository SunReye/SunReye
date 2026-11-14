<script lang="ts">
  import type { Layout, Problem } from "../api/core.ts";
  import { problemText } from "../i18n/problems";
  import { m } from "../paraglide/messages.js";
  import { misplacedText } from "./checks.ts";
  import type { Misplaced } from "./pv.ts";

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
  <p role="alert" class="mb-2 text-sm text-destructive">{misplacedText(misplaced)}</p>
{/if}
{#if saved !== undefined}
  {#if "problem" in saved}
    <p role="alert" class="mb-2 text-sm text-destructive">{problemText(saved.problem)}</p>
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
