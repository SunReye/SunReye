/**
 * THE SLUG: a typed name as a stable machine name.
 *
 * One implementation for the whole repo, and it has to be one. The server writes
 * the slug into every MQTT topic and every Home Assistant `unique_id` the moment
 * a device is provisioned, and it is frozen there. The web app shows the derived
 * slug LIVE as the operator types the name, because that preview is the only
 * moment the value can still be corrected — and a preview that disagreed with
 * what the server writes would be worse than no preview: it would show a
 * consequence that is not the one about to happen.
 *
 * It used to be two copies (`apps/server/src/inverter/provision.ts` and
 * `apps/web/src/lib/slug.ts`) held together by a test that extracted both
 * function bodies from disk and compared them character for character. This
 * package is the only one both the server and the web app may import, so the
 * copy — and the source-text test standing guard over it — is gone.
 */

/**
 * The longest slug this will emit — a topic segment, not a free-text field.
 *
 * Also the longest NAME accepted: migration onboarding and the device form both
 * refuse a longer name rather than letting `slugify` silently cut it
 * (`apps/server/src/migration/onboarding.ts`), because a truncation the operator
 * never chose is permanent.
 */
export const SLUG_MAX = 48;

/**
 * A typed name as a stable machine name.
 *
 * Diacritics are folded rather than stripped ("Süd" → "sud", not "sd"): the slug
 * is what a German operator sees in their MQTT topics and their Home Assistant
 * entity ids, and a dropped umlaut makes a word unreadable. Everything else
 * non-alphanumeric collapses to a single dash, and the result never begins or
 * ends with one — `<prefix>//<topic>` is not a topic.
 *
 * Returns `""` when nothing survives, which is a real case ("!!!"), and the
 * callers all have a named fallback for it. It never invents one here: the
 * fallback belongs where the meaning is ("plant", "inverter").
 */
export function slugify(text: string): string {
  return (
    text
      .normalize("NFKD")
      // Combining marks left by the decomposition above; `Ü` is now `U` + a mark.
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, SLUG_MAX)
      .replace(/-+$/g, "")
  );
}
