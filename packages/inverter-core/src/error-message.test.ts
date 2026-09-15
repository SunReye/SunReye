import { describe, expect, it } from "bun:test";

import { errorMessage } from "./error-message";

describe("errorMessage", () => {
  it("reads an Error's message", () => {
    expect(errorMessage(new Error("connect ECONNREFUSED"))).toBe("connect ECONNREFUSED");
  });

  it("names an Error that carries no message", () => {
    expect(errorMessage(new TypeError(""))).toBe("TypeError");
  });

  // modbus-serial's own failures are NOT Errors: `TransactionTimedOutError` is a
  // plain constructor function that sets name/message/errno on `this` and never
  // calls Error. `error instanceof Error` is false for one, so `String(error)`
  // renders it "[object Object]" — which is what a Solarman poll against the
  // wrong unit id put in front of the operator.
  it("reads the message off a modbus-serial failure, which is not an Error", () => {
    const timedOut = { name: "TransactionTimedOutError", message: "Timed out", errno: "ETIMEDOUT" };
    expect(errorMessage(timedOut)).toBe("Timed out");
  });

  it("falls back to name and errno when the message is null, as SerialPortError's is", () => {
    const refused = { name: "SerialPortError", message: null, errno: "ECONNREFUSED" };
    expect(errorMessage(refused)).toBe("SerialPortError (ECONNREFUSED)");
  });

  it("names a failure that has neither message nor errno", () => {
    expect(errorMessage({ name: "PortNotOpenError" })).toBe("PortNotOpenError");
  });

  it("passes a thrown string through", () => {
    expect(errorMessage("nope")).toBe("nope");
  });

  it("renders a thrown number", () => {
    expect(errorMessage(42)).toBe("42");
  });

  it("says something for nothing at all", () => {
    expect(errorMessage(null)).toBe("unknown error");
    expect(errorMessage(undefined)).toBe("unknown error");
  });

  it("serialises an object that names itself in no other way", () => {
    expect(errorMessage({ code: 500 })).toBe('{"code":500}');
  });

  it("survives an object that cannot be serialised", () => {
    const cyclic: { self?: unknown } = {};
    cyclic.self = cyclic;
    expect(errorMessage(cyclic)).toBe("[object Object]");
  });
});
