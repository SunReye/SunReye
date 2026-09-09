/**
 * THE SLUG, on the client — a byte-for-byte port of the server's.
 *
 * The migration onboarding form shows the derived slug LIVE as the operator types
 * their plant and device names, because that slug is about to be frozen into every
 * MQTT topic and every Home Assistant `unique_id` and this is the only moment it
 * can be corrected. A preview that disagreed with what the server actually writes
 * would be worse than no preview: it would show a consequence that is not the one
 * about to happen.
 *
 * The authority is `apps/server/src/inverter/provision.ts`. It cannot be imported
 * — the web app depends on no server package — so it is COPIED, and
 * `./slug.test.ts` extracts both function bodies and refuses any difference. That
 * test is the only thing making this file safe; do not edit one side of it.
 *
 * The server also refuses a NAME longer than {@link SLUG_MAX} rather than letting
 * this `slice` cut it, and the form does the same: a truncation the operator never
 * chose is permanent.
 */

/** The longest slug emitted, and therefore the longest name accepted. */
export const SLUG_MAX = 48;

/**
 * A typed name as a stable machine name.
 *
 * Diacritics are FOLDED, not stripped ("Süd" -> "sud"): the slug is what a German
 * operator sees in their topics and entity ids, and a dropped umlaut makes a word
 * unreadable. Returns "" when nothing survives ("!!!"), which is a real case the
 * form refuses rather than papers over.
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
