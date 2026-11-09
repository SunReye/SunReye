import { expect, test } from "bun:test";
import { binaryProblems } from "./elf.ts";
import { elf } from "./elf-fixture.ts";

test("a static, stripped binary for its architecture has no problems", () => {
  expect(binaryProblems(elf({ arch: "arm64" }), "arm64")).toEqual([]);
  expect(binaryProblems(elf({ arch: "amd64" }), "amd64")).toEqual([]);
});

test("a binary for another architecture is reported", () => {
  expect(binaryProblems(elf({ arch: "amd64" }), "arm64")).toEqual([
    "built for machine 62, not arm64 (183)",
  ]);
});

test("a binary that needs an interpreter or a shared library is not static", () => {
  expect(binaryProblems(elf({ arch: "arm64", interpreter: true }), "arm64")).toEqual([
    "not static: it names an interpreter",
  ]);
  expect(binaryProblems(elf({ arch: "arm64", needed: 1 }), "arm64")).toEqual([
    "not static: it needs a shared library",
  ]);
});

test("a binary with a symbol table is not stripped", () => {
  expect(binaryProblems(elf({ arch: "arm64", symbols: true }), "arm64")).toEqual([
    "not stripped: it has a symbol table",
  ]);
});

test("anything but a 64-bit little-endian ELF is reported", () => {
  expect(binaryProblems(new TextEncoder().encode("#!/bin/sh\n"), "amd64")).toEqual([
    "not a 64-bit little-endian ELF",
  ]);
});
