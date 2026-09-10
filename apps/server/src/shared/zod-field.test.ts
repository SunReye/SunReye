import { describe, expect, test } from "bun:test";
import { z } from "zod";

import { parseBody } from "./zod-field";

/**
 * Which field a refusal names. The cases that matter are the ones a bare
 * `String(path[0])` gets wrong — an array index, a nested path, and a field the
 * error class cannot name at all.
 */

const FIELDS = new Set(["name", "arrays", "params"] as const);

class Refused extends Error {
  constructor(
    message: string,
    readonly field: string | undefined,
  ) {
    super(message);
  }
}

/** Parse, and hand back what the refusal said — or throw if it was accepted. */
const refusalOf = (schema: z.ZodType, value: unknown): Refused => {
  try {
    parseBody(schema, value, FIELDS, (message, field) => new Refused(message, field));
  } catch (error) {
    if (error instanceof Refused) return error;
    throw error;
  }
  throw new Error("expected a refusal");
};

describe("parseBody", () => {
  test("a body the schema accepts comes back parsed, defaults applied", () => {
    const schema = z.object({ name: z.string().default("unnamed") });
    expect(parseBody(schema, {}, FIELDS, () => new Error("unreachable"))).toEqual({
      name: "unnamed",
    });
  });

  test("a top-level field is named", () => {
    const schema = z.object({ name: z.string().min(1, "name is required") });
    const refused = refusalOf(schema, { name: "" });
    expect(refused.message).toBe("name is required");
    expect(refused.field).toBe("name");
  });

  test("a NESTED path reports the OUTER field — the one the form has a control for", () => {
    const schema = z.object({ params: z.object({ topicRoot: z.string().min(1) }) });
    expect(refusalOf(schema, { params: { topicRoot: "" } }).field).toBe("params");
  });

  test('an ARRAY INDEX head does not become the field "0"', () => {
    const schema = z.object({ arrays: z.array(z.object({ kwp: z.number() })) });
    expect(refusalOf(schema, { arrays: [{ kwp: "no" }] }).field).toBe("arrays");
  });

  test("a field the error class cannot name is reported as undefined, not guessed", () => {
    const schema = z.object({ unlisted: z.string() });
    expect(refusalOf(schema, {}).field).toBeUndefined();
  });

  test("a whole-body refine has no field and still carries its message", () => {
    const schema = z.object({ name: z.string() }).refine(() => false, "nothing to change");
    const refused = refusalOf(schema, { name: "x" });
    expect(refused.field).toBeUndefined();
    expect(refused.message).toBe("nothing to change");
  });

  test("a body that is not an object at all still refuses with a message", () => {
    const schema = z.object({ name: z.string() });
    expect(refusalOf(schema, 7).message).not.toBe("");
  });
});
