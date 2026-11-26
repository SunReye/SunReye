// The app's language as state: messages are plain functions, so the root layout renders anew on it.
import { getLocale, setLocale, type Locale } from "../paraglide/runtime.js";

class Language {
  current = $state<Locale>(getLocale());

  /** Kept per browser by Paraglide's local-storage strategy (ADR 11); no reload. */
  async choose(next: Locale): Promise<void> {
    await setLocale(next, { reload: false });
    this.current = next;
  }
}

export const language = new Language();

/** A language in its own name, so an owner finds theirs whatever is shown. */
export function endonym(locale: Locale): string {
  return new Intl.DisplayNames([locale], { type: "language" }).of(locale) ?? locale;
}
