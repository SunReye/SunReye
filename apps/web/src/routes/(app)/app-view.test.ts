import { describe, expect, it } from "bun:test";
import { resolveView } from "./app-view";
import * as m from "$lib/paraglide/messages";

/** The message a view renders, or null when it renders the workspace. */
const text = (view: ReturnType<typeof resolveView>) =>
  view.kind === "message" ? view.text() : null;

const state = (over: Partial<Parameters<typeof resolveView>[0]>) =>
  resolveView({ pending: false, authed: false, anonAllowed: null, gate: null, ...over });

describe("resolveView", () => {
  it("waits while the session is still resolving", () => {
    expect(state({ pending: true, authed: true, gate: "ready" }).kind).toBe("message");
  });

  it("waits for the public-dashboard probe before judging a logged-out visitor", () => {
    expect(state({ anonAllowed: null }).kind).toBe("message");
  });

  it("gives an allowed anonymous visitor the read-only workspace", () => {
    expect(state({ anonAllowed: true }).kind).toBe("shell");
  });

  it("distinguishes the login redirect from the loading state", () => {
    expect(text(state({ anonAllowed: false }))).toBe(m.app_redirecting_login());
    expect(text(state({ anonAllowed: null }))).toBe(m.app_loading());
  });

  it("reports the first-run redirect rather than a bare loading state", () => {
    expect(text(state({ authed: true, gate: "setup-profile" }))).toBe(m.app_redirecting());
  });

  it("waits for the first-run gate, then renders the workspace", () => {
    expect(state({ authed: true, gate: null }).kind).toBe("message");
    expect(state({ authed: true, gate: "setup-account" }).kind).toBe("message");
    expect(state({ authed: true, gate: "setup-profile" }).kind).toBe("message");
    expect(state({ authed: true, gate: "ready" }).kind).toBe("shell");
  });

  it("prefers the anonymous path over the gate for a logged-out visitor", () => {
    expect(state({ authed: false, anonAllowed: true, gate: null }).kind).toBe("shell");
  });
});
