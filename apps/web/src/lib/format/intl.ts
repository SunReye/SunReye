// Shared plumbing for the locale-aware formatters in this folder.
//
// `Intl` defaults to the *browser's* locale, which is not the locale the user
// picked in SunReye, and constructing a formatter is the expensive part of
// formatting. Both facts are handled once here: read the paraglide locale at
// call time (so a language switch re-renders correctly), and keep one formatter
// per locale + option set.

import { getLocale } from "$lib/paraglide/runtime";

/** A cached formatter factory for one `Intl` constructor. */
export function localeFormatter<Options, Formatter>(
  create: (locale: string, options: Options) => Formatter,
): (options: Options) => Formatter {
  const cache = new Map<string, Formatter>();
  return (options: Options) => {
    const locale = getLocale();
    const key = `${locale}|${JSON.stringify(options)}`;
    let formatter = cache.get(key);
    if (!formatter) {
      formatter = create(locale, options);
      cache.set(key, formatter);
    }
    return formatter;
  };
}
