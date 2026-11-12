import type { Attempt, Problem } from "../api/core";
import type { Outcome } from "../components/value-editor/editable.ts";
import { problemText } from "../i18n/problems";
import { m } from "../paraglide/messages.js";

/** Every outcome's text; an outcome the core gains fails the type check until it has one. */
export const OUTCOMES: Readonly<Record<Attempt["outcome"], () => string>> = {
  verified: m.outcome_verified,
  mismatch: m.outcome_mismatch,
  unknown: m.outcome_unknown,
  partial: m.outcome_partial,
  unchanged: m.outcome_unchanged,
  refused: m.outcome_refused,
};

/** What the value editor shows of a write (ADR 21): it closes on a confirmed one and names the others' cause. */
export function editorOutcome(result: Readonly<Attempt> | Readonly<Problem>): Outcome {
  if ("problem" in result) return { kind: "refused", reason: problemText(result.problem) };

  if (result.outcome === "verified" || result.outcome === "unchanged") return { kind: "confirmed" };

  if (result.outcome === "refused") return { kind: "refused", reason: OUTCOMES.refused() };

  const step =
    result.failedStep === null || result.failedStep === undefined
      ? ""
      : ` ${m.settings_failed_step({ step: result.failedStep })}`;

  return { kind: "mismatch", reason: OUTCOMES[result.outcome]() + step };
}
