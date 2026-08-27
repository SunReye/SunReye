import { describe, expect, it } from "bun:test";
import { serializeApiKey } from "./api-key-view";

const row = {
  id: "k1",
  name: "grafana",
  prefix: "sr",
  start: "sr_abc",
  enabled: true,
  expiresAt: new Date("2027-01-02T03:04:05.000Z"),
  lastRequest: new Date("2026-08-27T10:11:12.000Z"),
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  userId: "u1",
  userEmail: "a@b.c",
  userName: "A",
};

describe("serializeApiKey", () => {
  // JSON has no Date, so every timestamp reaches the browser as a string
  // whatever the handler's type claims. Saying so here is what keeps the
  // declared response type and the wire in agreement — Eden infers the former
  // and the dashboard parses the latter.
  it("renders every timestamp as an ISO string", () => {
    const serialized = serializeApiKey(row);
    expect(serialized.createdAt).toBe("2026-01-01T00:00:00.000Z");
    expect(serialized.expiresAt).toBe("2027-01-02T03:04:05.000Z");
    expect(serialized.lastRequest).toBe("2026-08-27T10:11:12.000Z");
  });

  // A key that never expires and one that has never been used are both normal.
  it("keeps a null timestamp null rather than inventing an epoch", () => {
    const serialized = serializeApiKey({ ...row, expiresAt: null, lastRequest: null });
    expect(serialized.expiresAt).toBeNull();
    expect(serialized.lastRequest).toBeNull();
  });

  it("passes the non-timestamp columns through untouched", () => {
    expect(serializeApiKey(row)).toMatchObject({
      id: "k1",
      name: "grafana",
      prefix: "sr",
      start: "sr_abc",
      enabled: true,
      userId: "u1",
      userEmail: "a@b.c",
      userName: "A",
    });
  });

  it("keeps a nameless key nameless", () => {
    expect(serializeApiKey({ ...row, name: null }).name).toBeNull();
  });
});
