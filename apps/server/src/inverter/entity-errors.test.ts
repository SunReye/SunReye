import { describe, expect, it } from "bun:test";
import { ParseError, ValidationError } from "elysia/error";
import { entityErrorResponse } from "./entity-errors";

describe("entityErrorResponse", () => {
  // A third party sent a value the route's schema rejects. Their mistake, and
  // the detail is theirs to see.
  it("reports a validation failure as 422 with the validator's detail", () => {
    const failure = entityErrorResponse(new ValidationError("body", "not a number", []));
    expect(failure.status).toBe(422);
    expect(failure.body.error).toBe("Validation failed");
    expect(failure.body.detail).toBeString();
  });

  it("reports an unparseable body as 400", () => {
    const failure = entityErrorResponse(new ParseError());
    expect(failure.status).toBe(400);
    expect(failure.body).toEqual({ error: "Malformed request body" });
  });

  // Anything unrecognized is ours, not the caller's. A stack trace in the
  // response body is an information leak to every integrator.
  it("sanitizes an unexpected error to a bare 500", () => {
    const failure = entityErrorResponse(new Error("connection string: postgres://secret@host"));
    expect(failure.status).toBe(500);
    expect(failure.body).toEqual({ error: "Internal server error" });
  });

  it("sanitizes a thrown non-Error the same way", () => {
    const failure = entityErrorResponse("just a string");
    expect(failure.status).toBe(500);
    expect(failure.body).toEqual({ error: "Internal server error" });
  });

  // What goes to the log is the opposite of what goes to the caller: the stack
  // when there is one, so the 500 is diagnosable at all.
  it("hands back the stack to log for an unexpected error, and nothing to log otherwise", () => {
    expect(entityErrorResponse(new Error("boom")).log).toContain("boom");
    expect(entityErrorResponse("just a string").log).toBe("just a string");
    expect(entityErrorResponse(new ParseError()).log).toBeNull();
    expect(entityErrorResponse(new ValidationError("body", "x", [])).log).toBeNull();
  });
});
