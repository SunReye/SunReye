import { t } from "elysia";

/**
 * TURNING A SERVICE REFUSAL INTO A STATUS — the plumbing `./devices.ts` and
 * `./integrations.ts` share.
 *
 * Both settings services refuse the same way: a typed error carrying the status
 * it deserves, the message the operator reads and the input field it concerns
 * (`../devices/device-admin.ts`'s `DeviceAdminError`,
 * `../integrations/integration-admin.ts`'s `IntegrationAdminError`). Both routes
 * then have to do the same four things — catch it, map anything else to the 500
 * it deserves, parse a by-id parameter, and answer 400 when that parameter is
 * not an id.
 *
 * Spelled twice, those four things are ~35 lines of identical code per route
 * file, and the failure mode of a copy is silent: a route that forgets the
 * `throw` in {@link adminResponder} answers 400 to a genuine bug, and one that
 * forgets the id check hands `NaN` to a service that reads it as "no such row".
 *
 * THE ERROR CLASS IS A PARAMETER, not a base class the two services extend.
 * A shared superclass would make every refusal in one service assignable to the
 * other's handler, and the point of two classes is that the device roster and
 * the integration list refuse different things with different field names. The
 * guard is what each route file states about its own service, once.
 */

/** What a refused call carries. Structural: neither error class is imported here. */
interface AdminRefusal {
  status: 400 | 404 | 409;
  message: string;
  field?: string | null;
}

/** Elysia's `status` helper, narrowed to the codes a settings refusal uses. */
type StatusFn = (code: 400 | 404 | 409, body: unknown) => unknown;

/** A by-id param, or null. `NaN`, `0`, `-1` and `1.5` are all "not an id". */
function parseId(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

const BAD_ID = { error: "id must be a positive integer", field: null } as const;

/**
 * The route shapes for a `:id` endpoint.
 *
 * `id` is `t.String()`, not `t.Numeric()`, and the body is `t.Unknown()`: Elysia
 * validates a declared param or body BEFORE `beforeHandle`, where the gates
 * live, so a typed one would let the route smoke's probe stop at 422 and prove
 * nothing about who may call it (`scripts/route-smoke-plan.ts`). The id is
 * parsed by {@link adminResponder}'s `withId` instead, inside the handler and
 * behind the guard.
 */
export const byId = { requireAdmin: true, params: t.Object({ id: t.String() }) } as const;
export const byIdWrite = { ...byId, body: t.Unknown() } as const;

/**
 * The `respond`/`withId` pair for one service, bound to the guard that
 * recognises its refusals.
 *
 * Anything the guard does not recognise is RETHROWN, deliberately: a
 * `TypeError` from a handler is a bug, and answering it as a 400 with the
 * exception's message is how a broken route reads as a rejected input.
 */
export function adminResponder(isRefusal: (error: unknown) => boolean) {
  /** Run one service call, mapping its refusals to their status. */
  async function respond<T>(status: StatusFn, run: () => Promise<T>) {
    try {
      return await run();
    } catch (error) {
      if (!isRefusal(error)) throw error;
      const refused = error as AdminRefusal;
      return status(refused.status, { error: refused.message, field: refused.field ?? null });
    }
  }

  /** The same, for a `:id` route: a bad id is a 400 before the service is called. */
  function withId<T>(status: StatusFn, raw: string, run: (id: number) => Promise<T>) {
    const id = parseId(raw);
    if (id === null) return status(400, BAD_ID);
    return respond(status, () => run(id));
  }

  return { respond, withId };
}
