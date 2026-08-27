/**
 * The request-scoped context every log record picks up.
 *
 * `@logtape/elysia` did this behind its `context` option, and dropping the
 * plugin (it pins `elysia: ^1.4.0` and threw on Elysia 2) took it with it. It
 * is the one lost capability that cannot be reconstructed after the fact: an
 * error logged deep in the inverter runtime is only tied to the request that
 * caused it if the id was attached while it happened.
 *
 * LogTape reads this store itself — `configure({ contextLocalStorage })` in
 * ./logging — so nothing has to thread an id through call signatures.
 *
 * Lives apart from ./logging to keep the cycle out: ./request-log needs the
 * store, ./logging needs the store, and ./request-log logs.
 */
import { AsyncLocalStorage } from "node:async_hooks";

/** Handed to LogTape as its `contextLocalStorage`. */
export const requestContextStorage = new AsyncLocalStorage<Record<string, unknown>>();

/** The header a caller (or a reverse proxy) uses to supply its own id. */
export const CORRELATION_HEADER = "x-request-id";

/**
 * Ids reach every log line and the response headers, and are entirely
 * client-controlled. A newline would let a caller forge log records, so the
 * charset is deliberately narrow rather than merely stripped, and the length is
 * capped so one request cannot write a megabyte per line.
 */
const WELL_FORMED = /^[A-Za-z0-9._:-]{1,128}$/;

/** The supplied id if it is safe to repeat, else a fresh one. */
export function correlationId(supplied: string | null): string {
  const trimmed = supplied?.trim() ?? "";
  return WELL_FORMED.test(trimmed) ? trimmed : crypto.randomUUID();
}

/**
 * Attach `requestId` to every record emitted from here on in this async chain.
 *
 * `enterWith`, not `run`: Elysia's `request` hook returns before the handler
 * runs, so a callback-scoped context would close immediately. `enterWith` binds
 * the store to the current async context, which the handler and everything it
 * awaits inherit.
 */
export function enterRequestContext(requestId: string): void {
  requestContextStorage.enterWith({ ...requestContextStorage.getStore(), requestId });
}
