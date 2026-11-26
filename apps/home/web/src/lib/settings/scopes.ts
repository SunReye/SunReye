// A token's scope as the admin reads it (ADR 9).
import type { Scope } from "../api/core";
import { m } from "../paraglide/messages.js";

export const SCOPES: Readonly<Record<Scope, () => string>> = {
  read: m.access_scope_read,
  admin: m.access_scope_admin,
};
