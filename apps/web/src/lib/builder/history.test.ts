/// <reference types="bun" />
import { expect, test } from "bun:test";
import { begin, record, redo, undo } from "./history.ts";

test("undo steps back through each change and redo forward again", () => {
  const edited = record(record(begin("a"), "b"), "c");

  expect(undo(edited).present).toBe("b");
  expect(undo(undo(edited)).present).toBe("a");
  expect(redo(undo(undo(edited))).present).toBe("b");
});

test("a change after an undo drops the steps that were undone", () => {
  const branched = record(undo(record(begin("a"), "b")), "c");

  expect(redo(branched).present).toBe("c");
  expect(undo(branched).present).toBe("a");
});

test("there is nothing to undo at the start nor to redo at the end", () => {
  const start = begin("a");

  expect(undo(start)).toBe(start);
  expect(redo(start)).toBe(start);
});
