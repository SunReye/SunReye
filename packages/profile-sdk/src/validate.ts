import { hasResolvableKind, safeParseProfileData } from "@SunReye/inverter-core";
import type { ProfileData } from "@SunReye/inverter-core";

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
 * Semantic lints — a valid profile that is still probably wrong. Reported as
 * warnings by `profile validate`, and gated by `--strict` (the storage policy
 * in #109 keys off `resolveKind`, so a guessed kind becomes a data decision).
 *
 * Today's single lint: a metric whose kind is neither explicit nor implied by a
 * mapped role, its writability or a kWh unit resolves to `measurement` by
 * default — which silently turns a status enum into a deadbanded number.
 */
export function lintProfile(data: ProfileData): string[] {
  return data.metrics
    .filter((m) => !hasResolvableKind(m))
    .map(
      (m) =>
        `${m.key}: unresolvable kind — defaults to "measurement". ` +
        "Add an explicit `kind` (with `enumLabels` for an enum) or a canonical role.",
    );
}
