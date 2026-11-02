import * as m from "$lib/paraglide/messages";

const utf8 = new TextEncoder();

/** The core's password rule: at least 8 characters, at most 72 UTF-8 bytes (bcrypt reads no further), no NUL (bcrypt stops there). */
export function passwordRefusal(password: string): string | undefined {
  if ([...password].length < 8) return m.auth_password_min();
  if (utf8.encode(password).length > 72) return m.auth_password_max();
  if (password.includes("\0")) return m.auth_password_nul();
  return undefined;
}
