import { describe, expect, test } from "bun:test";

import { refusalOf, slugFields } from "./migration-submit";

const current = { plantSlug: "my-plant", deviceSlug: "inverter" };

describe("slugFields", () => {
  test("an untouched form sends no slug at all", () => {
    // The common case by far: the operator renames their plant, the identifier
    // preview follows, and nothing about the identifiers was chosen by hand.
    expect(
      slugFields({ editable: true, plantSlug: "my-plant", deviceSlug: "inverter", current }),
    ).toEqual({});
  });

  test("only the half that changed is sent", () => {
    expect(
      slugFields({ editable: true, plantSlug: "haus-sud", deviceSlug: "inverter", current }),
    ).toEqual({ plantSlug: "haus-sud" });
    expect(
      slugFields({ editable: true, plantSlug: "my-plant", deviceSlug: "wr-1", current }),
    ).toEqual({ deviceSlug: "wr-1" });
  });

  test("both, when both were corrected", () => {
    expect(
      slugFields({ editable: true, plantSlug: "haus-sud", deviceSlug: "wr-1", current }),
    ).toEqual({ plantSlug: "haus-sud", deviceSlug: "wr-1" });
  });

  test("NOTHING once the window has closed, however different the values are", () => {
    // The server refuses a slug change after discovery is announced. Sending one
    // anyway turns a finished form into a 409 the operator cannot act on — and the
    // names in that same submit would be lost with it.
    expect(
      slugFields({ editable: false, plantSlug: "haus-sud", deviceSlug: "wr-1", current }),
    ).toEqual({});
  });

  test("an empty current slug still counts as a change to compare against", () => {
    // An instance with no device row reports "" for its device slug; a submitted
    // value is then genuinely new rather than equal-and-skippable.
    expect(
      slugFields({
        editable: true,
        plantSlug: "my-plant",
        deviceSlug: "wr-1",
        current: { plantSlug: "my-plant", deviceSlug: "" },
      }),
    ).toEqual({ deviceSlug: "wr-1" });
  });
});

describe("refusalOf", () => {
  test("a 400's field errors are what the form renders, beside their inputs", () => {
    expect(
      refusalOf({
        status: 400,
        value: { error: "invalid", errors: { plantName: "Plant name is required." } },
      }),
    ).toEqual({ ok: false, errors: { plantName: "Plant name is required." } });
  });

  test("both fields at once — the form is shown ONCE and must not need two submits", () => {
    const result = refusalOf({
      status: 400,
      value: { errors: { plantName: "required", deviceName: "required" } },
    });
    expect(result).toEqual({
      ok: false,
      errors: { plantName: "required", deviceName: "required" },
    });
  });

  test("field errors WIN over a summary message", () => {
    // Otherwise the reason for a rejected field appears anywhere but next to it.
    expect(
      refusalOf({ status: 400, value: { message: "Something is wrong", errors: { x: "y" } } }),
    ).toEqual({ ok: false, errors: { x: "y" } });
  });

  test("a 409 has no field to blame, so its message IS the answer", () => {
    // `slug_frozen` and `onboarding_closed`: the refusal is about the instance's
    // state, not about anything the operator typed.
    expect(
      refusalOf({ status: 409, value: { error: "slug_frozen", message: "already announced" } }),
    ).toEqual({ ok: false, message: "already announced" });
  });

  test("a non-string error value is not a field error", () => {
    // The body crosses the network. `{ plantName: 7 }` rendered into the DOM is a
    // field error the operator cannot act on and did not cause.
    expect(refusalOf({ status: 400, value: { errors: { plantName: 7 } } })).toEqual({
      ok: false,
      message: "400",
    });
  });

  test("no body at all degrades to the status code rather than to nothing", () => {
    expect(refusalOf({ status: 503, value: null })).toEqual({ ok: false, message: "503" });
    expect(refusalOf({ status: 500 })).toEqual({ ok: false, message: "500" });
  });

  test("errors that is not an object is ignored, not spread", () => {
    expect(refusalOf({ status: 400, value: { errors: "nope", message: "bad" } })).toEqual({
      ok: false,
      message: "bad",
    });
  });
});
