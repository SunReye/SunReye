import { hasResolvableKind, safeParseProfileData } from "@SunReye/inverter-core";
import type { ProfileData } from "@SunReye/inverter-core";

import { semanticLints } from "./lints";

export interface ValidationResult {
  ok: boolean;
  /** Human-readable `path: message` lines, empty when valid. */
  issues: string[];
}

/** Run the strict profile validator and flatten its issues for display. */
export function validateProfile(input: unknown): ValidationResult {
  const result = safeParseProfileData(input);
  if (result.success) return { ok: true, issues: [] };
  return {
    ok: false,
    issues: result.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`),
  };
}

/**
 * The warning for one metric whose kind is a guess. An explicit `storage` takes
 * the *persistence* consequence off the table — the guess then only picks a
 * widget — so the sentence about storage is only written when it is true. A
 * warning that overstates its own stakes is a warning authors learn to skip.
 */
function kindWarning(m: { key: string; storage?: string }): string {
  const consequence =
    m.storage === undefined
      ? ' — defaults to "measurement", which also derives its storage class ' +
        "(change-only into the hypertable, with a deadband allowed)"
      : ' — defaults to "measurement"';
  return (
    `${m.key}: unresolvable kind${consequence}. ` +
    "Add an explicit `kind` (with `enumLabels` for an enum) or a canonical role."
  );
}

/**
 * Semantic lints — a valid profile that is still probably wrong. Reported as
 * warnings by `profile validate`, and gated by `--strict` (the storage policy
 * in #109 keys off `resolveKind`, so a guessed kind becomes a data decision).
 *
 * The first lint is kind resolution: a metric whose kind is neither explicit nor
 * implied by a mapped role, its writability or a kWh unit resolves to
 * `measurement` by default — which silently turns a status enum into a
 * deadbanded number. The rest are the physical-plausibility rules in ./lints
 * (unbounded percentages, signed energy counters, missed temperature offsets, …).
 */
export function lintProfile(data: ProfileData): string[] {
  const kindWarnings = data.metrics.filter((m) => !hasResolvableKind(m)).map(kindWarning);
  return [...kindWarnings, ...semanticLints(data).map((f) => f.message)];
}
