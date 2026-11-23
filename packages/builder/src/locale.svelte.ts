// The builder's language (ADR 25 "Its language"): its consumer's choice, else Paraglide's
// local-storage key, where Home keeps it. Every message reads it, so a change shows at once.
import { getLocale, overwriteGetLocale, type Locale } from "./paraglide/runtime.js";

export type { Locale } from "./paraglide/runtime.js";

const stored = getLocale;

let chosen = $state<Locale | null>(null);

overwriteGetLocale(() => chosen ?? stored());

/** Speaks `locale` from now on; null hands the choice back to the stored one. */
export function speak(locale: Locale | null): void {
  chosen = locale;
}
