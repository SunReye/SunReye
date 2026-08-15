import { afterEach, describe, expect, test } from "bun:test";

// The preload's own contract. Every message this app renders resolves through
// the Paraglide runtime, which reads the locale out of `localStorage` — a global
// that does not exist under bun. If the stub in ./test-setup.ts stops behaving
// like Storage, whole suites die at import with an error naming none of this.
//
// Each test hands the store back exactly as the preload left it: the pin is
// process-wide, and a suite that runs after a cleared store renders German.
const PIN = "PARAGLIDE_LOCALE";

afterEach(() => {
  localStorage.clear();
  localStorage.setItem(PIN, "en");
});

describe("the localStorage stub the test run leans on", () => {
  test("pins the locale to the base locale", () => {
    expect(localStorage.getItem(PIN)).toBe("en");
  });

  test("answers an unset key with null, not undefined", () => {
    // The runtime's strategies test the result against `null`; `undefined` reads
    // as a stored value and the locale resolution falls over.
    expect(localStorage.getItem("never-written")).toBeNull();
  });

  test("stores, overwrites and removes a value", () => {
    localStorage.setItem("theme", "dark");
    expect(localStorage.getItem("theme")).toBe("dark");
    localStorage.setItem("theme", "light");
    expect(localStorage.getItem("theme")).toBe("light");
    localStorage.removeItem("theme");
    expect(localStorage.getItem("theme")).toBeNull();
  });

  test("removing a key that was never there is not an error", () => {
    expect(() => localStorage.removeItem("never-written")).not.toThrow();
    expect(localStorage.length).toBe(1);
  });

  test("counts what it holds", () => {
    expect(localStorage.length).toBe(1);
    localStorage.setItem("a", "1");
    localStorage.setItem("b", "2");
    expect(localStorage.length).toBe(3);
    localStorage.removeItem("a");
    expect(localStorage.length).toBe(2);
  });

  test("enumerates its keys by index, and answers null past the end", () => {
    localStorage.setItem("a", "1");
    expect(localStorage.key(0)).toBe(PIN);
    expect(localStorage.key(1)).toBe("a");
    expect(localStorage.key(2)).toBeNull();
    expect(localStorage.key(-1)).toBeNull();
  });

  test("clearing empties it — including the locale pin", () => {
    localStorage.setItem("a", "1");
    localStorage.clear();
    expect(localStorage.length).toBe(0);
    expect(localStorage.getItem(PIN)).toBeNull();
    expect(localStorage.key(0)).toBeNull();
  });
});
