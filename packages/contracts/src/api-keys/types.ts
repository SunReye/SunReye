/**
 * The admin API-key row, shared because both ends need the same answer about
 * its timestamps.
 *
 * JSON has no Date, so a `Date` column reaches the browser as a string whatever
 * the handler's return type says. Under Elysia 1, Eden inferred the serialized
 * shape and happened to agree with the dashboard's local copy of this type;
 * Eden 2 propagates the declared `Date` instead, and the two stopped matching.
 * Declaring it once here — and serializing to match, see the server's
 * `serializeApiKey` — is what keeps them from drifting again.
 */
export interface ApiKeyView {
  id: string;
  name: string | null;
  prefix: string | null;
  start: string | null;
  enabled: boolean;
  /** ISO-8601, or null for a key that never expires. */
  expiresAt: string | null;
  /** ISO-8601, or null for a key that has never been used. */
  lastRequest: string | null;
  /** ISO-8601. */
  createdAt: string;
  userId: string;
  userEmail: string;
  userName: string;
}
