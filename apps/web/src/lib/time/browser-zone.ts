/**
 * The zone this BROWSER is in — the viewer's own clock, nothing more.
 *
 * Kept out of `./period.ts` on purpose: that module refuses to know a default
 * zone so callers cannot silently inherit one (see its header, and issue #46).
 * This is the answer for windows the viewer picked on their own calendar — the
 * history and statistics date pickers. Anything bucketed against server data
 * wants the PLANT zone instead, and must ask for it explicitly.
 */
export function browserTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}
