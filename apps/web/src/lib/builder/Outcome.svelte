<script lang="ts">
  import type { Layout, Problem } from "../api/core.ts";
  import { problemText } from "../i18n/problems";
  import { m } from "../paraglide/messages.js";
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

  function misplacedText(at: Misplaced): string {
    if (!("row" in at)) return at.kind === "face" ? m.misplaced_face() : m.misplaced_moduleType();

    const cell = { grid: at.grid + 1, row: at.row + 1, column: at.column + 1 };

    return at.kind === "setback" ? m.misplaced_setback(cell) : m.misplaced_overlap(cell);
  }

  function name(layout: Layout, id: number): string {
    return layout.strings.find((string) => string.id === id)?.name ?? String(id);
  }
</script>

{#if misplaced !== null}
  <p role="alert">{misplacedText(misplaced)}</p>
{/if}
{#if saved !== undefined}
  {#if "problem" in saved}
    <p role="alert">{problemText(saved.problem)}</p>
  {:else}
    <p role="status">{m.builder_saved()}</p>
    <!-- A warning, never a refusal: the plant may already exist (ADR 20). -->
    {#each saved.warnings as warning (warning.string)}
      <p role="alert">
        {m.builder_cold_voltage({
          name: name(saved, warning.string),
          voltage: Math.round(warning.openCircuitVoltage),
          limit: Math.round(warning.maxInputVoltage),
        })}
      </p>
    {/each}
  {/if}
{/if}
