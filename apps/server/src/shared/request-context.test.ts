/**
 * Request-scoped correlation.
 *
 * `@logtape/elysia` offered this and we lost it with the plugin: an id per
 * request, attached to EVERY log record emitted while that request is handled,
 * so a failure deep in the engine can be tied back to what asked for it. A flat
 * log cannot be correlated after the fact, which is why this is the one dropped
 * capability worth rebuilding.
 */
import { describe, expect, it } from "bun:test";
import { correlationId, enterRequestContext, requestContextStorage } from "./request-context";

describe("correlationId", () => {
  it("accepts a well-formed id the caller supplied", () => {
    expect(correlationId("abc-123")).toBe("abc-123");
    expect(correlationId("01JBRX9K7Q8Y5V3ZTGM2W4NPQR")).toBe("01JBRX9K7Q8Y5V3ZTGM2W4NPQR");
  });

  it("generates one when the header is absent or blank", () => {
    expect(correlationId(null)).toMatch(/^[0-9a-f-]{36}$/);
    expect(correlationId("")).toMatch(/^[0-9a-f-]{36}$/);
    expect(correlationId("   ")).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("gives every generated id a different value", () => {
    expect(correlationId(null)).not.toBe(correlationId(null));
  });

  // The id reaches every log line and the response headers, and it is entirely
  // client-controlled. Newlines would forge log records; the rest is header
  // hygiene and keeping one request from writing a megabyte per line.
  it("refuses an id carrying anything that could forge a log line", () => {
    for (const forged of ["a\nINF fake record", "a\r\nSet-Cookie: x=1", "a\tb", "a b"]) {
      expect(correlationId(forged)).not.toContain(forged);
      expect(correlationId(forged)).toMatch(/^[0-9a-f-]{36}$/);
    }
  });

  it("refuses an absurdly long id", () => {
    expect(correlationId("a".repeat(200))).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("keeps an id at the length limit", () => {
    const atLimit = "a".repeat(128);
    expect(correlationId(atLimit)).toBe(atLimit);
  });
});

describe("enterRequestContext", () => {
  it("makes the id visible to everything downstream in the same async chain", async () => {
    const seen: (string | undefined)[] = [];
    const deep = async () => {
      await new Promise((r) => setTimeout(r, 1));
      seen.push(requestContextStorage.getStore()?.requestId as string | undefined);
    };

    await requestContextStorage.run({}, async () => {
      enterRequestContext("req-1");
      await deep();
    });
    expect(seen).toEqual(["req-1"]);
  });

  // Two requests in flight must not read each other's id — the bug the old
  // plugin had with its app-level `store`.
  it("keeps concurrent requests apart", async () => {
    const observe = async (id: string, delayMs: number): Promise<string | undefined> =>
      requestContextStorage.run({}, async () => {
        enterRequestContext(id);
        await new Promise((r) => setTimeout(r, delayMs));
        return requestContextStorage.getStore()?.requestId as string | undefined;
      });

    expect(await Promise.all([observe("a", 8), observe("b", 1), observe("c", 4)])).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  it("reports nothing outside a request", () => {
    expect(requestContextStorage.getStore()?.requestId).toBeUndefined();
  });
});
