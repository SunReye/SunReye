/**
 * WHAT A THROWN THING SAYS, when it is not necessarily an Error.
 *
 * The idiom this replaces — `error instanceof Error ? error.message : String(error)`
 * — is correct for everything the platform throws and WRONG for the library this
 * package is built on. modbus-serial's three failure types are plain constructor
 * functions that set `name`, `message` and `errno` on `this` and never call
 * `Error` (`modbus-serial/index.js:51-74`), so `instanceof Error` is false for
 * every one of them and `String(…)` renders the message-carrying object as
 * "[object Object]".
 *
 * That is not a cosmetic loss. A Solarman poll against a unit id nothing answers
 * on fails with `TransactionTimedOutError` — the single most common real
 * misconfiguration on a logging stick — and the connection test reported it to
 * the operator as "Fehlgeschlagen: [object Object]", i.e. as no reason at all.
 *
 * Lives here, dependency-free and on its own subpath, because the callers span
 * the package that owns modbus-serial and the server that surfaces its failures
 * — and the server's reachability probe must stay loadable without modbus-serial
 * on the import path.
 */

/** A thrown thing that names itself the way modbus-serial's failures do. */
interface Named {
  name?: unknown;
  message?: unknown;
  errno?: unknown;
}

/** What a thrown object calls itself: its message, else its name and errno. */
function nameOf(error: object): string | null {
  const { name, message, errno } = error as Named;
  // A message is the reason; everything below is what is left when there is none.
  if (typeof message === "string" && message !== "") return message;
  if (typeof name !== "string" || name === "") return null;
  return typeof errno === "string" && errno !== "" ? `${name} (${errno})` : name;
}

/**
 * The JSON of an object that describes itself in no other way — better than
 * "[object Object]", and the fallback when even this fails (cyclic, or a getter
 * that throws) is the honest answer for a value that will not describe itself.
 */
function serialised(error: object): string {
  try {
    return JSON.stringify(error) ?? String(error);
  } catch {
    return String(error);
  }
}

/** The one string worth showing for anything at all. Never "[object Object]". */
export function errorMessage(error: unknown): string {
  if (error === null || error === undefined) return "unknown error";
  // Covers a thrown string, which is already its own message, and a number.
  if (typeof error !== "object") return String(error);
  return nameOf(error) ?? serialised(error);
}
