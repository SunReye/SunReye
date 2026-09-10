import { describe, expect, test } from "bun:test";

import { adminResponder, byId, byIdWrite } from "./admin-refusal";

/**
 * The refusal plumbing both settings routes share.
 *
 * Worth its own suite rather than being left to the two route files, because
 * the route layer has no automated cover beyond a smoke sweep that only asks
 * "did the handler run at all" — and the two failures this code exists to
 * prevent both pass a smoke sweep. A `respond` that swallowed an unrecognised
 * error would answer 400 to a genuine bug with the exception's own message;
 * a `withId` that let `NaN` through would hand it to a service that reads it as
 * "no such row" and answer 404 to a malformed request.
 */

class Refused extends Error {
  constructor(
    readonly status: 400 | 404 | 409,
    message: string,
    readonly field?: string,
  ) {
    super(message);
  }
}

const responder = adminResponder((error) => error instanceof Refused);

/** Elysia's `status`, as a value a test can read. */
const capture = () => {
  const calls: { code: number; body: unknown }[] = [];
  const status = (code: 400 | 404 | 409, body: unknown) => {
    calls.push({ code, body });
    return body;
  };
  return { status, calls };
};

describe("the by-id route shapes", () => {
  test("the id param and the body stay UNTYPED so the gate answers before validation", () => {
    // Elysia validates a declared param or body before `beforeHandle`, so a
    // `t.Numeric()` id would make the route smoke's placeholder 422 and prove
    // nothing about who may call the route.
    expect(byId.requireAdmin).toBe(true);
    expect(byId.params.properties.id.type).toBe("string");
    expect(byIdWrite.body).toEqual(expect.anything());
    expect((byIdWrite.body as { type?: string }).type).toBeUndefined();
  });
});

describe("respond", () => {
  test("it returns what the call returned", async () => {
    const { status, calls } = capture();
    expect(await responder.respond(status, async () => ({ ok: true }))).toEqual({ ok: true });
    expect(calls).toEqual([]);
  });

  test("a recognised refusal becomes its status, message and field", async () => {
    const { status, calls } = capture();
    await responder.respond(status, async () => {
      throw new Refused(409, "already there", "kind");
    });
    expect(calls).toEqual([{ code: 409, body: { error: "already there", field: "kind" } }]);
  });

  test("a refusal with no field reports null rather than omitting the key", async () => {
    const { status, calls } = capture();
    await responder.respond(status, async () => {
      throw new Refused(404, "gone");
    });
    expect(calls[0]?.body).toEqual({ error: "gone", field: null });
  });

  test("an UNRECOGNISED error is rethrown — a bug must not read as a bad request", async () => {
    const { status, calls } = capture();
    const boom = responder.respond(status, async () => {
      throw new TypeError("undefined is not a function");
    });
    expect(boom).rejects.toThrow(TypeError);
    expect(calls).toEqual([]);
  });
});

describe("withId", () => {
  test("a good id reaches the call", async () => {
    const { status } = capture();
    expect(await responder.withId(status, "7", async (id) => ({ id }))).toEqual({ id: 7 });
  });

  test("zero, a negative, a fraction, a word and the smoke's placeholder are all 400", async () => {
    // `scripts/route-smoke-plan.ts` sends `route-smoke-absent` when it could not
    // discover a real id; the route must answer 400 rather than hand `NaN` to a
    // service that reads it as "no such row" and answers 404.
    for (const raw of ["0", "-1", "1.5", "abc", "", " ", "route-smoke-absent"]) {
      const { status, calls } = capture();
      let ran = false;
      await responder.withId(status, raw, async () => void (ran = true));
      expect(calls).toEqual([
        { code: 400, body: { error: "id must be a positive integer", field: null } },
      ]);
      expect(ran).toBe(false);
    }
  });

  test("a refusal from a by-id call still maps to its status", async () => {
    const { status, calls } = capture();
    await responder.withId(status, "7", async () => {
      throw new Refused(404, "integration 7 does not exist");
    });
    expect(calls[0]?.code).toBe(404);
  });
});
