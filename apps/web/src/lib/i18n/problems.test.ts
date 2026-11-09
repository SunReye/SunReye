/// <reference types="bun" />
import { expect, test } from "bun:test";
import document from "../../../../../crates/core/openapi.json";
import { problemText } from "./problems.ts";

/** Every code the core can answer with, from the document it serves (ADR 9). */
const CODES: readonly string[] = document.components.schemas.Code.enum;

test.each(CODES)("%s reads in German and in English", (code) => {
  const german = problemText(code, "de");
  const english = problemText(code, "en");

  expect([german, english]).not.toContain(problemText("no.such-code", "de"));
  expect([german, english]).not.toContain(problemText("no.such-code", "en"));
  // A message missing from one language falls back to German.
  expect(english).not.toBe(german);
});

test("German is the default", () => {
  expect(problemText("auth.required")).toBe(problemText("auth.required", "de"));
});

test("a refusal with no problem document names its HTTP status", () => {
  expect(problemText("http.502", "en")).toContain("502");
  expect(problemText("http.502", "de")).toContain("502");
});

test("a code this build does not know is named as it is", () => {
  expect(problemText("device.melted", "en")).toContain("device.melted");
});
