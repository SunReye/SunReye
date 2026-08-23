/**
 * The one error type that says "the caller's value was wrong", as opposed to
 * "the inverter failed".
 *
 * It lives in its own module rather than beside the funnel because both sides of
 * the write path have to throw it and the dependency runs one way: the funnel
 * (`control-writer.ts`) imports the interpreter (`control-expr.ts`) to dispatch
 * composite controls, so the interpreter cannot import back without a cycle.
 *
 * Why it matters that both use the same type: a refusal that reaches an entry
 * point as a plain `Error` is indistinguishable from a Modbus timeout, so the
 * same caller mistake answers 400 through a plain register write and 502 through
 * a composite control. The type *is* the status-code decision.
 */
export class WriteRejectedError extends Error {
  override readonly name = "WriteRejectedError";
}
